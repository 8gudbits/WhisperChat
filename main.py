import server, logging
from waitress import serve
from datetime import datetime


# ANSI escape codes for colors
LAQUA = "\033[96m"    # Light Aqua
GREEN = "\033[92m"    # Bright green
RESET = "\033[0m"     # Reset to default

server_host = "0.0.0.0"
server_port = "8080"


if __name__ == "__main__":
    app = server.WhisperChat(server_host, server_port)

    # Configure logging for Waitress
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    logger = logging.getLogger("waitress")
    logger.setLevel(logging.DEBUG)

    # Get the current time
    start_time = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    
    # Print a startup message
    startup_message = (
        f"{GREEN}{start_time} Server started at {LAQUA}http://{server_host}:{server_port}{RESET}\n"
    )
    print(startup_message)
    serve(app.app, host=server_host, port=server_port)

