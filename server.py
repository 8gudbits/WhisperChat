import secrets, random
from logging.config import dictConfig
from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import join_room, leave_room, send, SocketIO
from string import ascii_uppercase
from datetime import datetime


# ANSI escape codes for colors
LAQUA = "\033[96m"    # Light Aqua
GREEN = "\033[92m"    # Bright green
RESET = "\033[0m"     # Reset to default

APPNAME, VERSION = "WhisperChat", "1.0.0"
SECRET_KEY = secrets.token_hex(24)


class WhisperChat:
    def __init__(self, host="127.0.0.1", port=8080):
        self.app = Flask(f"{APPNAME} - v{VERSION}")
        self.app.config["SECRET_KEY"] = SECRET_KEY
        self.socketio = SocketIO(self.app)
        self.SERVER_HOST = host
        self.SERVER_PORT = port
        self.rooms = {}

        self.configure_logging()
        self.setup_routes()

    def generate_unique_code(self, length):
        while True:
            code = ""
            for _ in range(length):
                code += random.choice(ascii_uppercase)
            if code not in self.rooms:
                break
        return code
    
    def configure_logging(self):
        dictConfig({
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
        })

    def setup_routes(self):
        @self.app.route("/", methods=["POST", "GET"])
        def home():
            session.clear()
            if request.method == "POST":
                name = request.form.get("name")
                code = request.form.get("code")
                join = request.form.get("join", False)
                create = request.form.get("create", False)

                if not name:
                    return render_template(
                        "home.html", error="Please enter a name.", code=code, name=name
                    )

                if join != False and not code:
                    return render_template(
                        "home.html",
                        error="Please enter a room code.",
                        code=code,
                        name=name,
                    )

                room = code
                if create != False:
                    room = self.generate_unique_code(6)
                    self.rooms[room] = {"members": 0, "messages": []}
                elif code not in self.rooms:
                    return render_template(
                        "home.html", error="Room does not exist.", code=code, name=name
                    )

                session["room"] = room
                session["name"] = name
                return redirect(url_for("room"))

            return render_template("home.html")

        @self.app.route("/room")
        def room():
            room = session.get("room")
            if room is None or session.get("name") is None or room not in self.rooms:
                return redirect(url_for("home"))

            return render_template(
                "room.html", code=room, messages=self.rooms[room]["messages"]
            )

        @self.socketio.on("message")
        def message(data):
            room = session.get("room")
            if room not in self.rooms:
                return

            content = {"name": session.get("name"), "message": data["data"]}
            send(content, to=room)
            self.rooms[room]["messages"].append(content)
            print(f"{session.get('name')} said: {data['data']}")

        @self.socketio.on("connect")
        def connect(auth):
            room = session.get("room")
            name = session.get("name")
            if not room or not name:
                return
            if room not in self.rooms:
                leave_room(room)
                return

            join_room(room)
            send({"name": name, "message": "has entered the room"}, to=room)
            self.rooms[room]["members"] += 1
            print(f"{name} joined room {room}")

        @self.socketio.on("disconnect")
        def disconnect():
            room = session.get("room")
            name = session.get("name")
            leave_room(room)

            if room in self.rooms:
                self.rooms[room]["members"] -= 1
                if self.rooms[room]["members"] <= 0:
                    del self.rooms[room]

            send({"name": name, "message": "has left the room"}, to=room)
            print(f"{name} has left the room {room}")

    def run(self, debug=False):
        start_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
        print(f"{GREEN}{start_time}{RESET} {APPNAME} v{VERSION} starting up on {LAQUA}http://{self.SERVER_HOST}:{self.SERVER_PORT}{RESET}")
        self.socketio.run(self.app, host=self.SERVER_HOST, port=self.SERVER_PORT, debug=debug)


if __name__ == "__main__":
    live_chat_room = WhisperChat(host="127.0.0.1", port=8080)
    live_chat_room.run(debug=True)

