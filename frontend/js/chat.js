let CONFIG = {};

class ChatRoom {
  constructor() {
    this.loadConfig().then(() => {
      this.socket = io(CONFIG.BACKEND_URL);
      this.roomCode = null;
      this.username = null;
      this.lastSender = null;
      this.init();
    });
  }

  async loadConfig() {
    const response = await fetch("js/cfg.json");
    CONFIG = await response.json();
  }

  init() {
    this.loadUserData();
    this.setupParticles();
    this.setupEventListeners();
    this.setupSocketHandlers();
    this.joinRoom();
  }

  loadUserData() {
    this.username = localStorage.getItem("username");
    this.roomCode =
      new URLSearchParams(window.location.search).get("room") ||
      localStorage.getItem("roomCode");

    if (!this.username || !this.roomCode) {
      window.location.href = "index.html";
      return;
    }

    document.getElementById("room-code-display").textContent = this.roomCode;
  }

  setupParticles() {
    // Only setup particles on desktop
    if (typeof particlesJS !== "undefined" && window.innerWidth > 672) {
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
  }

  setupEventListeners() {
    const sendBtn = document.getElementById("send-btn");
    const messageInput = document.getElementById("message-input");
    const copyBtn = document.getElementById("copy-btn");

    if (sendBtn) {
      sendBtn.addEventListener("click", () => this.sendMessage());
    }

    if (copyBtn) {
      copyBtn.addEventListener("click", () => this.copyRoomCode());
    }

    if (messageInput) {
      messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.sendMessage();
        }
      });

      // Auto-focus on mobile for better UX
      if (window.innerWidth <= 672) {
        setTimeout(() => {
          messageInput.focus();
        }, 300);
      } else {
        messageInput.focus();
      }
    }

    // Handle window resize to toggle particles
    window.addEventListener("resize", () => {
      this.handleResize();
    });

    window.addEventListener("beforeunload", () => {
      this.leaveRoom();
    });
  }

  handleResize() {
    // Re-initialize particles when switching between mobile and desktop
    const particlesContainer = document.getElementById("particles-js");
    if (window.innerWidth > 672 && particlesContainer.children.length === 0) {
      this.setupParticles();
    }
  }

  setupSocketHandlers() {
    this.socket.on("connect", () => {});

    this.socket.on("disconnect", (reason) => {});

    this.socket.on("connect_error", (error) => {
      alert("Failed to connect to chat server");
    });

    this.socket.on("error", (data) => {
      alert(data.message || "Chat error occurred");
    });

    this.socket.on("message_history", (data) => {
      data.messages.forEach((msg) => this.displayMessage(msg));
    });

    this.socket.on("new_message", (data) => {
      this.displayMessage(data);
    });

    this.socket.on("user_joined", (data) => {
      this.displaySystemMessage(`${data.username} joined the room`);
    });

    this.socket.on("user_left", (data) => {
      this.displaySystemMessage(`${data.username} left the room`);
    });
  }

  joinRoom() {
    this.socket.emit("join", {
      room_code: this.roomCode,
      username: this.username,
    });
  }

  leaveRoom() {
    this.socket.emit("leave");
  }

  sendMessage() {
    const input = document.getElementById("message-input");
    const message = input.value.trim();

    if (!message) {
      return;
    }

    this.socket.emit("send_message", { message });
    input.value = "";

    // Keep focus on mobile for better UX
    if (window.innerWidth <= 672) {
      setTimeout(() => {
        input.focus();
      }, 100);
    } else {
      input.focus();
    }
  }

  displayMessage(messageData) {
    const container = document.getElementById("messages-container");
    if (!container) {
      return;
    }

    const isOwnMessage = messageData.username === this.username;
    const showUsername = this.lastSender !== messageData.username;
    this.lastSender = messageData.username;

    const messageElement = document.createElement("div");
    messageElement.className = `message ${
      isOwnMessage ? "message-own" : "message-other"
    }`;

    const time = new Date(messageData.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    messageElement.innerHTML = `
      ${
        showUsername
          ? `<div class="message-username show">${messageData.username}</div>`
          : '<div class="message-username"></div>'
      }
      <div class="message-bubble">
        <div class="message-content">${this.escapeHtml(
          messageData.message
        )}</div>
        <div class="message-time">${time}</div>
      </div>
    `;

    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
  }

  displaySystemMessage(message) {
    const container = document.getElementById("messages-container");
    if (!container) {
      return;
    }

    const messageElement = document.createElement("div");
    messageElement.className = "message message-system";

    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    messageElement.innerHTML = `
      <span class="system-time">${time}</span>
      <span class="system-text">${message}</span>
    `;

    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;

    // Reset last sender for context change
    this.lastSender = null;
  }

  copyRoomCode() {
    navigator.clipboard
      .writeText(this.roomCode)
      .then(() => {
        this.showToast();
      })
      .catch((err) => {});
  }

  showToast() {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.classList.add("show");
      setTimeout(() => {
        toast.classList.remove("show");
      }, 3000);
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ChatRoom();
});

