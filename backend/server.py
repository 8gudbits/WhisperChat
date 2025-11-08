import os, secrets, random, threading
from logging.config import dictConfig
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from string import ascii_uppercase
from datetime import datetime


# =========================================================== #
#  CONFIGURATION - Edit these values to customize the server  #
# =========================================================== #
class Config:
    # Application Settings
    APP_NAME = "WhisperChat"
    VERSION = "2.0.0-rc2"
    SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(24))

    # Server Settings
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", 8080))

    # CORS Settings
    ORIGINS = ["*"]  # Allow all origins; modify as needed

    # Room Settings
    ROOM_CODE_LENGTH = 6
    ROOM_CLEANUP_DELAY = 120.0  # in seconds (2 minutes)

    # ANSI colors for console output
    class Colors:
        AQUA = "\033[96m"
        GREEN = "\033[92m"
        RESET = "\033[0m"


# ============================ #
#  CHAT SERVER IMPLEMENTATION  #
# ============================ #
class ChatServer:
    def __init__(self, host=None, port=None):
        self.app = Flask(f"{Config.APP_NAME}-API")
        self.app.config["SECRET_KEY"] = Config.SECRET_KEY

        # CORS configuration
        CORS(self.app, resources={r"/api/*": {"origins": Config.ORIGINS}})

        self.socketio = SocketIO(
            self.app, cors_allowed_origins="*", logger=True, manage_session=False
        )

        self.host = host or Config.HOST
        self.port = port or Config.PORT
        self.rooms = {}
        self.user_sessions = {}
        self.room_cleanup_timers = {}

        self._setup_logging()
        self._setup_routes()
        self._setup_socket_handlers()

    def _generate_room_code(self, length=None):
        """Generate a unique room code"""
        length = length or Config.ROOM_CODE_LENGTH
        while True:
            code = "".join(random.choices(ascii_uppercase, k=length))
            if code not in self.rooms:
                return code

    def _setup_logging(self):
        dictConfig(
            {
                "version": 1,
                "formatters": {
                    "default": {
                        "format": "%(levelname).1s: %(message)s",
                    }
                },
                "handlers": {
                    "wsgi": {
                        "class": "logging.StreamHandler",
                        "stream": "ext://flask.logging.wsgi_errors_stream",
                        "formatter": "default",
                    }
                },
                "root": {"level": "INFO", "handlers": ["wsgi"]},
            }
        )

    def _setup_routes(self):
        @self.app.route("/api/health", methods=["GET"])
        def health_check():
            return jsonify(
                {
                    "status": "healthy",
                    "service": Config.APP_NAME,
                    "version": Config.VERSION,
                    "active_rooms": len(self.rooms),
                }
            )

        @self.app.route("/api/rooms", methods=["POST"])
        def create_room():
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

            # Cancel any pending cleanup for this room (in case of reuse)
            if room_code in self.room_cleanup_timers:
                self.room_cleanup_timers[room_code].cancel()
                del self.room_cleanup_timers[room_code]

            return jsonify(
                {"room_code": room_code, "message": "Room created successfully"}
            )

        @self.app.route("/api/rooms/<room_code>/exists", methods=["GET"])
        def check_room(room_code):
            exists = room_code in self.rooms
            return jsonify({"exists": exists})

    def _schedule_room_cleanup(self, room_code):
        """Schedule room cleanup after delay of being empty"""
        if room_code in self.room_cleanup_timers:
            self.room_cleanup_timers[room_code].cancel()

        def cleanup():
            if room_code in self.rooms and self.rooms[room_code]["members"] == 0:
                del self.rooms[room_code]
                print(
                    f"Room {room_code} cleaned up after being empty for {Config.ROOM_CLEANUP_DELAY} seconds"
                )
            if room_code in self.room_cleanup_timers:
                del self.room_cleanup_timers[room_code]

        timer = threading.Timer(Config.ROOM_CLEANUP_DELAY, cleanup)
        timer.daemon = True
        timer.start()
        self.room_cleanup_timers[room_code] = timer

    def _setup_socket_handlers(self):
        @self.socketio.on("connect")
        def handle_connect():
            print(f"Client connected: {request.sid}")
            self.user_sessions[request.sid] = {}

        @self.socketio.on("disconnect")
        def handle_disconnect():
            print(f"Client disconnected: {request.sid}")
            if request.sid in self.user_sessions:
                session_data = self.user_sessions[request.sid]
                room_code = session_data.get("room_code")
                username = session_data.get("username")

                if room_code and room_code in self.rooms:
                    self.rooms[room_code]["members"] -= 1
                    self.rooms[room_code]["last_activity"] = datetime.now()

                    # If room is now empty, schedule cleanup
                    if self.rooms[room_code]["members"] <= 0:
                        self._schedule_room_cleanup(room_code)
                    else:
                        # Notify remaining users
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
            room_code = data.get("room_code")
            username = data.get("username")

            if not room_code or not username:
                emit("error", {"message": "Room code and username are required"})
                return

            if room_code not in self.rooms:
                emit("error", {"message": "Room does not exist"})
                return

            # Cancel cleanup timer if room is being rejoined
            if room_code in self.room_cleanup_timers:
                self.room_cleanup_timers[room_code].cancel()
                del self.room_cleanup_timers[room_code]
                print(f"Room {room_code} cleanup cancelled - user rejoined")

            self.user_sessions[request.sid] = {
                "room_code": room_code,
                "username": username,
            }

            join_room(room_code)
            self.rooms[room_code]["members"] += 1
            self.rooms[room_code]["last_activity"] = datetime.now()

            # Notify room about new user
            emit(
                "user_joined",
                {
                    "username": username,
                    "timestamp": datetime.now().isoformat(),
                    "member_count": self.rooms[room_code]["members"],
                },
                to=room_code,
            )

            # Send message history to new user
            emit("message_history", {"messages": self.rooms[room_code]["messages"]})

            print(f"{username} joined room {room_code}")

        @self.socketio.on("leave")
        def handle_leave():
            if request.sid in self.user_sessions:
                session_data = self.user_sessions[request.sid]
                room_code = session_data.get("room_code")
                username = session_data.get("username")

                if room_code and room_code in self.rooms:
                    leave_room(room_code)
                    self.rooms[room_code]["members"] -= 1
                    self.rooms[room_code]["last_activity"] = datetime.now()

                    # If room is now empty, schedule cleanup
                    if self.rooms[room_code]["members"] <= 0:
                        self._schedule_room_cleanup(room_code)
                    else:
                        # Notify remaining users
                        emit(
                            "user_left",
                            {
                                "username": username,
                                "timestamp": datetime.now().isoformat(),
                                "member_count": self.rooms[room_code]["members"],
                            },
                            to=room_code,
                        )

                    print(f"{username} left room {room_code}")

                del self.user_sessions[request.sid]

        @self.socketio.on("send_message")
        def handle_message(data):
            if request.sid not in self.user_sessions:
                emit("error", {"message": "Not in a room"})
                return

            session_data = self.user_sessions[request.sid]
            room_code = session_data.get("room_code")
            username = session_data.get("username")
            message_text = data.get("message")

            if not room_code or room_code not in self.rooms or not message_text:
                return

            # Update last activity
            self.rooms[room_code]["last_activity"] = datetime.now()

            message_data = {
                "id": secrets.token_hex(8),
                "username": username,
                "message": message_text,
                "timestamp": datetime.now().isoformat(),
            }

            # Store message
            self.rooms[room_code]["messages"].append(message_data)

            # Broadcast to room
            emit("new_message", message_data, to=room_code)

            print(f"Message from {username} in {room_code}: {message_text}")

    def start(self, debug=False):
        start_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        print(
            f"{Config.Colors.GREEN}{start_time}{Config.Colors.RESET} {Config.APP_NAME} v{Config.VERSION}"
        )
        print(
            f"Server starting on {Config.Colors.AQUA}http://{self.host}:{self.port}{Config.Colors.RESET}"
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

