import os
import secrets
import random
from logging.config import dictConfig
from flask import Flask, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from string import ascii_uppercase
from datetime import datetime

# Configuration
APP_NAME = "WhisperChat"
VERSION = "2.0.0-rc1"
SECRET_KEY = os.getenv("SECRET_KEY", secrets.token_hex(24))


# ANSI colors for console
class Colors:
    AQUA = "\033[96m"
    GREEN = "\033[92m"
    RESET = "\033[0m"


class ChatServer:
    def __init__(self, host="0.0.0.0", port=8080):
        self.app = Flask(f"{APP_NAME}-API")
        self.app.config["SECRET_KEY"] = SECRET_KEY
        self.app.config["SESSION_TYPE"] = "filesystem"

        # CORS configuration
        CORS(self.app, resources={r"/api/*": {"origins": "*"}})

        self.socketio = SocketIO(
            self.app,
            cors_allowed_origins="*",
            logger=True,
            manage_session=False,  # Let Flask handle sessions
        )

        self.host = host
        self.port = port
        self.rooms = {}
        # Store user sessions by socket ID
        self.user_sessions = {}

        self._setup_logging()
        self._setup_routes()
        self._setup_socket_handlers()

    def _generate_room_code(self, length=6):
        """Generate a unique room code"""
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
                    "service": APP_NAME,
                    "version": VERSION,
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
            }

            return jsonify(
                {"room_code": room_code, "message": "Room created successfully"}
            )

        @self.app.route("/api/rooms/<room_code>/exists", methods=["GET"])
        def check_room(room_code):
            exists = room_code in self.rooms
            return jsonify({"exists": exists})

    def _setup_socket_handlers(self):
        @self.socketio.on("connect")
        def handle_connect():
            print(f"Client connected: {request.sid}")
            # Initialize session for this socket
            self.user_sessions[request.sid] = {}

        @self.socketio.on("disconnect")
        def handle_disconnect():
            print(f"Client disconnected: {request.sid}")
            # Clean up session
            if request.sid in self.user_sessions:
                session_data = self.user_sessions[request.sid]
                room_code = session_data.get("room_code")
                username = session_data.get("username")

                if room_code and room_code in self.rooms:
                    self.rooms[room_code]["members"] -= 1

                    if self.rooms[room_code]["members"] <= 0:
                        del self.rooms[room_code]
                    else:
                        # Notify room about user leaving
                        emit(
                            "user_left",
                            {
                                "username": username,
                                "timestamp": datetime.now().isoformat(),
                                "member_count": self.rooms[room_code]["members"],
                            },
                            to=room_code,
                        )

                # Remove session
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

            # Store user session data
            self.user_sessions[request.sid] = {
                "room_code": room_code,
                "username": username,
            }

            join_room(room_code)
            self.rooms[room_code]["members"] += 1

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

                    if self.rooms[room_code]["members"] <= 0:
                        del self.rooms[room_code]
                    else:
                        # Notify room about user leaving
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

                # Clear session
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
        print(f"{Colors.GREEN}{start_time}{Colors.RESET} {APP_NAME} v{VERSION}")
        print(
            f"Server starting on {Colors.AQUA}http://{self.host}:{self.port}{Colors.RESET}"
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
    server = ChatServer(
        host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8080))
    )
    server.start(debug=True)

