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
    const usernameInput = document.getElementById("username-input");
    const roomCodeInput = document.getElementById("room-code-input");

    usernameInput.addEventListener("input", (e) => {
      this.validateUsernameInput(e.target);
    });

    roomCodeInput.addEventListener("input", (e) => {
      this.validateRoomCodeInput(e.target);
    });

    usernameInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const cleaned = this.cleanUsername(text);
      document.execCommand("insertText", false, cleaned);
    });

    roomCodeInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      const cleaned = this.cleanRoomCode(text);
      document.execCommand("insertText", false, cleaned);
    });

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

  validateUsernameInput(input) {
    const originalValue = input.value;
    const cleanedValue = this.cleanUsername(originalValue);

    if (originalValue !== cleanedValue) {
      const cursorPosition =
        input.selectionStart - (originalValue.length - cleanedValue.length);
      input.value = cleanedValue;
      input.setSelectionRange(cursorPosition, cursorPosition);
    }
  }

  validateRoomCodeInput(input) {
    const originalValue = input.value;
    const cleanedValue = this.cleanRoomCode(originalValue);

    if (originalValue !== cleanedValue) {
      const cursorPosition =
        input.selectionStart - (originalValue.length - cleanedValue.length);
      input.value = cleanedValue;
      input.setSelectionRange(cursorPosition, cursorPosition);
    }
  }

  cleanUsername(input) {
    return input.replace(/[^a-zA-Z0-9]/g, "");
  }

  cleanRoomCode(input) {
    return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  }

  isValidUsername(username) {
    return (
      /^[a-zA-Z0-9]+$/.test(username) &&
      username.length >= 1 &&
      username.length <= 20
    );
  }

  isValidRoomCode(roomCode) {
    return (
      /^[A-Z0-9]+$/.test(roomCode) &&
      roomCode.length >= 1 &&
      roomCode.length <= 8
    );
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
    const usernameInput = document.getElementById("username-input");
    let username = usernameInput.value.trim();

    username = this.cleanUsername(username);
    usernameInput.value = username;

    if (!username) {
      this.showError("Please enter your name");
      return;
    }

    if (!this.isValidUsername(username)) {
      this.showError(
        "Name can only contain letters and numbers (1-20 characters)"
      );
      return;
    }

    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: this.escapeHtml(username) }),
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
    const usernameInput = document.getElementById("username-input");
    const roomCodeInput = document.getElementById("room-code-input");

    let username = usernameInput.value.trim();
    let roomCode = roomCodeInput.value.trim();

    username = this.cleanUsername(username);
    roomCode = this.cleanRoomCode(roomCode);

    usernameInput.value = username;
    roomCodeInput.value = roomCode;

    if (!username) {
      this.showError("Please enter your name");
      return;
    }

    if (!this.isValidUsername(username)) {
      this.showError(
        "Name can only contain letters and numbers (1-20 characters)"
      );
      return;
    }

    if (!roomCode) {
      this.showError("Please enter a room code");
      return;
    }

    if (!this.isValidRoomCode(roomCode)) {
      this.showError("Room code can only contain letters and numbers");
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
    const safeUsername = this.escapeHtml(username);
    const safeRoomCode = this.escapeHtml(roomCode);

    localStorage.setItem("username", safeUsername);
    localStorage.setItem("roomCode", safeRoomCode);

    window.location.href = `chat.html?room=${encodeURIComponent(safeRoomCode)}`;
  }

  escapeHtml(text) {
    if (text == null) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\//g, "&#x2F;");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ChatApp();
});

