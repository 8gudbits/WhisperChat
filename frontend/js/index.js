let CONFIG = {};

class ChatApp {
  constructor() {
    this.loadConfig().then(() => {
      this.socket = io(CONFIG.BACKEND_URL);
      this.init();
    });
  }

  async loadConfig() {
    const response = await fetch("js/cfg.json");
    CONFIG = await response.json();
  }

  init() {
    this.setupParticles();
    this.setupEventListeners();
  }

  setupParticles() {
    particlesJS("particles-js", {
      particles: {
        number: { value: 40, density: { enable: true, value_area: 500 } },
        color: { value: "#6366f1" },
        shape: { type: "circle" },
        opacity: { value: 0.3, random: true },
        size: { value: 2, random: true },
        line_linked: {
          enable: true,
          distance: 100,
          color: "#8b5cf6",
          opacity: 0.2,
          width: 1,
        },
        move: { enable: true, speed: 0.5, direction: "none", random: true },
      },
      interactivity: {
        detect_on: "canvas",
        events: {
          onhover: { enable: true, mode: "grab" },
          onclick: { enable: true, mode: "push" },
          resize: true,
        },
      },
    });
  }

  setupEventListeners() {
    document
      .getElementById("join-btn")
      .addEventListener("click", () => this.joinRoom());
    document
      .getElementById("create-btn")
      .addEventListener("click", () => this.createRoom());

    document
      .getElementById("room-code-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.joinRoom();
      });

    document
      .getElementById("username-input")
      .addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.joinRoom();
      });
  }

  showError(message) {
    const errorDiv = document.getElementById("error-message");
    const errorText = document.getElementById("error-text");
    errorText.textContent = message;
    errorDiv.style.display = "block";
  }

  hideError() {
    document.getElementById("error-message").style.display = "none";
  }

  async createRoom() {
    const username = document.getElementById("username-input").value.trim();

    if (!username) {
      this.showError("Please enter your name");
      return;
    }

    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();

      if (response.ok) {
        this.redirectToChat(username, data.room_code);
      } else {
        this.showError(data.error || "Failed to create room");
      }
    } catch (error) {
      this.showError("Cannot connect to server");
    }
  }

  async joinRoom() {
    const username = document.getElementById("username-input").value.trim();
    const roomCode = document
      .getElementById("room-code-input")
      .value.trim()
      .toUpperCase();

    if (!username) {
      this.showError("Please enter your name");
      return;
    }

    if (!roomCode) {
      this.showError("Please enter a room code");
      return;
    }

    try {
      const response = await fetch(
        `${CONFIG.BACKEND_URL}/api/rooms/${roomCode}/exists`
      );
      const data = await response.json();

      if (data.exists) {
        this.redirectToChat(username, roomCode);
      } else {
        this.showError("Room not found");
      }
    } catch (error) {
      this.showError("Cannot connect to server");
    }
  }

  redirectToChat(username, roomCode) {
    localStorage.setItem("username", username);
    localStorage.setItem("roomCode", roomCode);
    window.location.href = `chat.html?room=${roomCode}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ChatApp();
});

