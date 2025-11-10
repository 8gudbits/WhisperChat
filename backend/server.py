import os
import secrets
import logging
import random
import base64
import threading

from flask import Flask, request, abort, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
from logging.config import dictConfig
from string import ascii_uppercase
from PIL import Image
from io import BytesIO
from datetime import datetime


# ===================================================== #
#  CONFIGURATION - Edit values to customize the server  #
# ===================================================== #
class Config:
    """Server configuration settings"""

    ###  Application Settings  ###
    APP_NAME, VERSION = "WhisperChat", "2.0.0-rc7"
    SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(24))

    ###  Server Settings  ###
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 8080))

    ###  CORS Settings  ###
    ## Allow all origins; modify as needed
    ## Example: ORIGINS = ["http://localhost:5500", "https://mydomain.com"]
    ORIGINS = ["*"]

    ###  Room Settings  ###
    ROOM_CODE_LENGTH = 7
    ROOM_CLEANUP_DELAY = 120.0  # in seconds

    ###  Image Settings  ###
    MAX_IMAGE_SIZE = 24 * 1024 * 1024  # 24MB
    ALLOWED_IMAGE_FORMATS = ["JPEG", "PNG", "GIF", "WEBP"]

    ###  ANSI colors for console output  ###
    class Colors:
        WHITE = "\033[97m"
        AQUA = "\033[96m"
        GREEN = "\033[92m"
        YELLOW = "\033[93m"
        RED = "\033[91m"
        RESET = "\033[0m"


class ColorFormatter(logging.Formatter):
    """Custom formatter for colored logs"""

    COLORS = {
        logging.INFO: Config.Colors.WHITE,
        logging.WARNING: Config.Colors.YELLOW,
        logging.ERROR: Config.Colors.RED,
        logging.DEBUG: Config.Colors.AQUA,
    }

    def format(self, record):
        color = self.COLORS.get(record.levelno, Config.Colors.RESET)
        message = super().format(record)
        return f"{color}{message}{Config.Colors.RESET}"


# ============================ #
#  CHAT SERVER IMPLEMENTATION  #
# ============================ #
class ChatServer:
    """Main chat server implementation"""

    def __init__(self, host=None, port=None):
        self.app = Flask(f"{Config.APP_NAME}-API")
        self.app.config["SECRET_KEY"] = Config.SECRET_KEY
        self.app.config["MAX_CONTENT_LENGTH"] = Config.MAX_IMAGE_SIZE
        self.app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False
        self.app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

        CORS(self.app, resources={r"/api/*": {"origins": Config.ORIGINS}})
        self.socketio = SocketIO(
            self.app, cors_allowed_origins="*", logger=True, manage_session=False
        )

        self.host = host or Config.HOST
        self.port = port or Config.PORT
        self.rooms = {}
        self.user_sessions = {}
        self.room_cleanup_timers = {}
        self.logger = logging.getLogger(__name__)

        self._setup_logging()
        self._setup_routes()
        self._setup_socket_handlers()

    def _generate_room_code(self, length=None):
        """Generate unique room code"""
        length = length or Config.ROOM_CODE_LENGTH
        while True:
            code = "".join(random.choices(ascii_uppercase, k=length))
            if code not in self.rooms:
                return code

    def _validate_image(self, image_data):
        """Validate image format and size"""
        try:
            if "," in image_data:
                image_data = image_data.split(",")[1]

            image_bytes = base64.b64decode(image_data)
            if len(image_bytes) > Config.MAX_IMAGE_SIZE:
                return (
                    None,
                    f"Image size too large (max {Config.MAX_IMAGE_SIZE // (1024*1024)}MB)",
                )

            try:
                image = Image.open(BytesIO(image_bytes))
                if image.format not in Config.ALLOWED_IMAGE_FORMATS:
                    return (
                        None,
                        f"Unsupported image format: {image.format}. Allowed: {', '.join(Config.ALLOWED_IMAGE_FORMATS)}",
                    )
            except Exception as img_error:
                self.logger.warning(f"Image format validation failed: {img_error}")
                pass

            return image_data, None

        except Exception as e:
            return None, f"Invalid image: {str(e)}"

    def _setup_logging(self):
        """Configure application logging with colors"""
        handler = logging.StreamHandler()
        handler.setFormatter(ColorFormatter("%(levelname).1s: %(message)s"))

        dictConfig(
            {
                "version": 1,
                "handlers": {
                    "wsgi": {
                        "()": lambda: handler,
                    }
                },
                "root": {"level": "INFO", "handlers": ["wsgi"]},
                "disable_existing_loggers": False,
            }
        )

    def _setup_routes(self):
        """Setup Flask API routes"""

        @self.app.route("/api/serverinfo", methods=["GET"])
        def server_info():
            """Get server information"""
            allowed_host = f"localhost:{Config.PORT}"
            if request.host != allowed_host:
                abort(403, description="Invalid Host Header")
            return jsonify(
                {
                    "service": Config.APP_NAME,
                    "version": Config.VERSION,
                    "active_rooms": len(self.rooms),
                }
            )

        @self.app.route("/api/rooms", methods=["POST"])
        def create_room():
            """Create a new chat room"""
            data = request.get_json()
            username = data.get("username")

            if not username:
                return jsonify({"error": "Username is required"}), 400

            room_code = self._generate_room_code()
            self.rooms[room_code] = {
                "members": 0,
                "messages": [],
                "created_at": datetime.now().isoformat(),
                "last_activity": datetime.now(),
            }

            if room_code in self.room_cleanup_timers:
                self.room_cleanup_timers[room_code].cancel()
                del self.room_cleanup_timers[room_code]

            self.logger.info(f"Room created: {room_code}")
            return jsonify(
                {"room_code": room_code, "message": "Room created successfully"}
            )

        @self.app.route("/api/rooms/<room_code>/exists", methods=["GET"])
        def check_room(room_code):
            """Check if room exists"""
            exists = room_code in self.rooms
            return jsonify({"exists": exists})

        @self.app.after_request
        def add_security_headers(response):
            """Add security headers to responses"""
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["X-XSS-Protection"] = "1; mode=block"
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
            return response

    def _schedule_room_cleanup(self, room_code):
        """Schedule room cleanup after delay"""
        if room_code in self.room_cleanup_timers:
            self.room_cleanup_timers[room_code].cancel()

        def cleanup():
            if room_code in self.rooms and self.rooms[room_code]["members"] == 0:
                del self.rooms[room_code]
                self.logger.info(
                    f"Room {room_code} cleaned up after being empty for {Config.ROOM_CLEANUP_DELAY} seconds"
                )
            if room_code in self.room_cleanup_timers:
                del self.room_cleanup_timers[room_code]

        timer = threading.Timer(Config.ROOM_CLEANUP_DELAY, cleanup)
        timer.daemon = True
        timer.start()
        self.room_cleanup_timers[room_code] = timer

    def _setup_socket_handlers(self):
        """Setup Socket.IO event handlers"""

        @self.socketio.on("connect")
        def handle_connect():
            """Handle client connection"""
            self.logger.info(f"Client connected: {request.sid}")
            self.user_sessions[request.sid] = {}

        @self.socketio.on("disconnect")
        def handle_disconnect():
            """Handle client disconnection"""
            self.logger.info(f"Client disconnected: {request.sid}")
            if request.sid in self.user_sessions:
                session_data = self.user_sessions[request.sid]
                room_code = session_data.get("room_code")
                username = session_data.get("username")

                if room_code and room_code in self.rooms:
                    self.rooms[room_code]["members"] -= 1
                    self.rooms[room_code]["last_activity"] = datetime.now()

                    if self.rooms[room_code]["members"] <= 0:
                        self._schedule_room_cleanup(room_code)
                    else:
                        emit(
                            "user_left",
                            {
                                "username": username,
                                "timestamp": datetime.now().isoformat(),
                                "member_count": self.rooms[room_code]["members"],
                            },
                            to=room_code,
                        )

                del self.user_sessions[request.sid]

        @self.socketio.on("join")
        def handle_join(data):
            """Handle user joining room"""
            room_code = data.get("room_code")
            username = data.get("username")

            if not room_code or not username:
                emit("error", {"message": "Room code and username are required"})
                return

            if room_code not in self.rooms:
                emit("error", {"message": "Room does not exist"})
                return

            if room_code in self.room_cleanup_timers:
                self.room_cleanup_timers[room_code].cancel()
                del self.room_cleanup_timers[room_code]
                self.logger.info(f"Room {room_code} cleanup cancelled - user rejoined")

            self.user_sessions[request.sid] = {
                "room_code": room_code,
                "username": username,
            }

            join_room(room_code)
            self.rooms[room_code]["members"] += 1
            self.rooms[room_code]["last_activity"] = datetime.now()

            emit(
                "user_joined",
                {
                    "username": username,
                    "timestamp": datetime.now().isoformat(),
                    "member_count": self.rooms[room_code]["members"],
                },
                to=room_code,
            )

            emit("message_history", {"messages": self.rooms[room_code]["messages"]})

            self.logger.info(f"{username} joined room {room_code}")

        @self.socketio.on("leave")
        def handle_leave():
            """Handle user leaving room"""
            if request.sid in self.user_sessions:
                session_data = self.user_sessions[request.sid]
                room_code = session_data.get("room_code")
                username = session_data.get("username")

                if room_code and room_code in self.rooms:
                    leave_room(room_code)
                    self.rooms[room_code]["members"] -= 1
                    self.rooms[room_code]["last_activity"] = datetime.now()

                    if self.rooms[room_code]["members"] <= 0:
                        self._schedule_room_cleanup(room_code)
                    else:
                        emit(
                            "user_left",
                            {
                                "username": username,
                                "timestamp": datetime.now().isoformat(),
                                "member_count": self.rooms[room_code]["members"],
                            },
                            to=room_code,
                        )

                    self.logger.info(f"{username} left room {room_code}")

                del self.user_sessions[request.sid]

        @self.socketio.on("send_message")
        def handle_message(data):
            """Handle sending messages"""
            if request.sid not in self.user_sessions:
                emit("error", {"message": "Not in a room"})
                return

            session_data = self.user_sessions[request.sid]
            room_code = session_data.get("room_code")
            username = session_data.get("username")
            message_text = data.get("message")
            image_data = data.get("image")

            if not room_code or room_code not in self.rooms:
                return

            if not message_text and not image_data:
                return

            self.rooms[room_code]["last_activity"] = datetime.now()

            message_data = {
                "id": secrets.token_hex(8),
                "username": username,
                "message": message_text,
                "timestamp": datetime.now().isoformat(),
            }

            if image_data:
                validated_image, error = self._validate_image(image_data)
                if error:
                    emit("error", {"message": error})
                    return
                message_data["image"] = validated_image
                message_data["type"] = "image"
                if not message_text:
                    message_data["message"] = "Sent an image"

            self.rooms[room_code]["messages"].append(message_data)
            emit("new_message", message_data, to=room_code)

            log_message = f"Message from {username} in {room_code}"
            if image_data:
                log_message += " (with image)"
            self.logger.info(log_message)

    def start(self, debug=False):
        """Start the chat server"""
        start_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        print(
            f"{Config.Colors.GREEN}{start_time} {Config.Colors.AQUA}{Config.APP_NAME} v{Config.VERSION}{Config.Colors.RESET}"
        )
        print(
            f"{Config.Colors.GREEN}Server starting on {Config.Colors.AQUA}http://{self.host}:{self.port}{Config.Colors.RESET}"
        )

        self.socketio.run(
            self.app,
            host=self.host,
            port=self.port,
            debug=debug,
            use_reloader=debug,
            allow_unsafe_werkzeug=debug,
        )


if __name__ == "__main__":
    server = ChatServer()
    server.start(debug=True)

