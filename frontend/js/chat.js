let CONFIG = {};

class ChatRoom {
  constructor() {
    this.loadConfig().then(() => {
      this.socket = io(CONFIG.BACKEND_URL);
      this.roomCode = null;
      this.username = null;
      this.lastSender = null;
      this.pendingImage = null;
      this.isSendMode = false;
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
    const messageInput = document.getElementById("message-input");
    const copyBtn = document.getElementById("copy-btn");
    const actionBtn = document.getElementById("action-btn");
    const imageInput = document.getElementById("image-input");
    const imageModal = document.getElementById("image-modal");
    const modalClose = document.querySelector(".image-modal-close");
    const sendImageBtn = document.getElementById("send-image-btn");
    const cancelImageBtn = document.getElementById("cancel-image-btn");

    if (copyBtn) {
      copyBtn.addEventListener("click", () => this.copyRoomCode());
    }

    if (actionBtn) {
      actionBtn.addEventListener("click", () => this.handleActionButton());
    }

    if (imageInput) {
      imageInput.addEventListener("change", (e) => this.handleImageSelect(e));
    }

    if (messageInput) {
      messageInput.addEventListener("input", () => this.handleInputChange());
      messageInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          this.handleActionButton();
        }
      });

      if (window.innerWidth <= 672) {
        setTimeout(() => {
          messageInput.focus();
        }, 300);
      } else {
        messageInput.focus();
      }
    }

    if (modalClose) {
      modalClose.addEventListener("click", () => this.closeImageModal());
    }

    if (sendImageBtn) {
      sendImageBtn.addEventListener("click", () => this.sendImageMessage());
    }

    if (cancelImageBtn) {
      cancelImageBtn.addEventListener("click", () => this.closeImageModal());
    }

    if (imageModal) {
      imageModal.addEventListener("click", (e) => {
        if (e.target === imageModal) {
          this.closeImageModal();
        }
      });
    }

    window.addEventListener("resize", () => {
      this.handleResize();
    });

    window.addEventListener("beforeunload", () => {
      this.leaveRoom();
    });
  }

  handleInputChange() {
    const messageInput = document.getElementById("message-input");
    const actionBtn = document.getElementById("action-btn");
    const imageIcon = document.getElementById("image-icon");
    const sendIcon = document.getElementById("send-icon");

    const hasText = messageInput.value.trim().length > 0;

    if (hasText && !this.isSendMode) {
      // Switch to send mode
      this.isSendMode = true;
      actionBtn.classList.add("send-mode");
      actionBtn.title = "Send message";
      imageIcon.style.display = "none";
      sendIcon.style.display = "block";
    } else if (!hasText && this.isSendMode) {
      // Switch back to image mode
      this.isSendMode = false;
      actionBtn.classList.remove("send-mode");
      actionBtn.title = "Upload Image";
      imageIcon.style.display = "block";
      sendIcon.style.display = "none";
    }
  }

  handleActionButton() {
    if (this.isSendMode) {
      this.sendMessage();
    } else {
      document.getElementById("image-input").click();
    }
  }

  handleResize() {
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
    this.handleInputChange(); // Reset button to image mode

    if (window.innerWidth <= 672) {
      setTimeout(() => {
        input.focus();
      }, 100);
    } else {
      input.focus();
    }
  }

  handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select a valid image file.");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      alert("Image size must be less than 8MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.pendingImage = {
        data: e.target.result,
        file: file,
      };
      this.showImagePreview(e.target.result);
    };
    reader.readAsDataURL(file);

    event.target.value = "";
  }

  showImagePreview(imageData) {
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("image-modal-img");

    if (modal && modalImg) {
      modalImg.src = imageData;
      modal.style.display = "block";
      document.body.style.overflow = "hidden";
    }
  }

  closeImageModal() {
    const modal = document.getElementById("image-modal");
    if (modal) {
      modal.style.display = "none";
      document.body.style.overflow = "";
      this.pendingImage = null;
    }
  }

  sendImageMessage() {
    if (!this.pendingImage) return;

    const messageInput = document.getElementById("message-input");
    const caption = messageInput.value.trim();

    this.socket.emit("send_message", {
      message: caption,
      image: this.pendingImage.data,
    });

    messageInput.value = "";
    this.closeImageModal();
    this.handleInputChange(); // Reset button to image mode

    if (window.innerWidth <= 672) {
      setTimeout(() => {
        messageInput.focus();
      }, 100);
    } else {
      messageInput.focus();
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

    let imageHtml = "";
    if (messageData.image) {
      imageHtml = `
        <div class="message-image-container">
          <img src="data:image/jpeg;base64,${messageData.image}" 
               alt="Shared image" 
               class="message-image"
               onclick="chatRoom.showFullImage('data:image/jpeg;base64,${
                 messageData.image
               }')">
          ${
            messageData.message && messageData.message !== "📷 Sent an image"
              ? `<div class="message-image-caption">${this.escapeHtml(
                  messageData.message
                )}</div>`
              : ""
          }
        </div>
      `;
    }

    messageElement.innerHTML = `
      ${
        showUsername
          ? `<div class="message-username show">${messageData.username}</div>`
          : '<div class="message-username"></div>'
      }
      <div class="message-bubble">
        ${messageData.image ? imageHtml : ""}
        ${
          !messageData.image
            ? `<div class="message-content">${this.escapeHtml(
                messageData.message
              )}</div>`
            : ""
        }
        <div class="message-time">${time}</div>
      </div>
    `;

    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
  }

  showFullImage(imageSrc) {
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("image-modal-img");

    if (modal && modalImg) {
      modalImg.src = imageSrc;
      modal.style.display = "block";
      document.body.style.overflow = "hidden";

      const actions = document.querySelector(".image-modal-actions");
      if (actions) {
        actions.style.display = "none";
      }
    }
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

let chatRoom;

document.addEventListener("DOMContentLoaded", () => {
  chatRoom = new ChatRoom();
});

