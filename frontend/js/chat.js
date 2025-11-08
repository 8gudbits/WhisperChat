let CONFIG = {};

class ChatRoom {
  constructor() {
    this.loadConfig().then(() => {
      this.socket = io(CONFIG.BACKEND_URL);
      this.roomCode = null;
      this.username = null;
      this.lastSender = null;
      this.pendingImages = [];
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
    this.setupDragAndDrop();
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

  setupDragAndDrop() {
    const dragDropZone = document.getElementById("drag-drop-zone");

    document.addEventListener("dragenter", (e) => {
      if (e.dataTransfer.types.includes("Files")) {
        dragDropZone.classList.add("active");
      }
    });

    dragDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragDropZone.classList.add("drag-over");
    });

    dragDropZone.addEventListener("dragleave", (e) => {
      if (!dragDropZone.contains(e.relatedTarget)) {
        dragDropZone.classList.remove("drag-over", "active");
      }
    });

    dragDropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDropZone.classList.remove("drag-over", "active");

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );

      if (files.length > 0) {
        this.handleImageFiles(files);
      }
    });
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

    copyBtn.addEventListener("click", () => this.copyRoomCode());
    actionBtn.addEventListener("click", () => this.handleActionButton());
    imageInput.addEventListener("change", (e) => this.handleImageSelect(e));
    modalClose.addEventListener("click", () => this.closeImageModal());
    sendImageBtn.addEventListener("click", () => this.sendImageMessage());
    cancelImageBtn.addEventListener("click", () => this.closeImageModal());

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

    imageModal.addEventListener("click", (e) => {
      if (e.target === imageModal) {
        this.closeImageModal();
      }
    });

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
      this.isSendMode = true;
      actionBtn.classList.add("send-mode");
      actionBtn.title = "Send message";
      imageIcon.style.display = "none";
      sendIcon.style.display = "block";
    } else if (!hasText && this.isSendMode) {
      this.isSendMode = false;
      actionBtn.classList.remove("send-mode");
      actionBtn.title = "Upload Images";
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
    this.handleInputChange();

    if (window.innerWidth <= 672) {
      setTimeout(() => {
        input.focus();
      }, 100);
    } else {
      input.focus();
    }
  }

  handleImageSelect(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    const validImageFiles = files.filter(
      (file) => file.type.startsWith("image/") && file.size <= 8 * 1024 * 1024
    );

    if (validImageFiles.length === 0) {
      alert("Please select valid image files (max 8MB each).");
      return;
    }

    if (validImageFiles.length !== files.length) {
      alert(
        `${validImageFiles.length} valid images selected. Some files were skipped.`
      );
    }

    this.handleImageFiles(validImageFiles);
    event.target.value = "";
  }

  handleImageFiles(files) {
    this.pendingImages = [];
    let filesProcessed = 0;

    files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.pendingImages.push({
          data: e.target.result,
          file: file,
          id: Date.now() + index,
        });
        filesProcessed++;

        if (filesProcessed === files.length) {
          this.showImagePreviews();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  showImagePreviews() {
    const modal = document.getElementById("image-modal");
    const previewContainer = document.getElementById("image-preview-container");
    const imageCounter = document.getElementById("image-counter");

    if (!modal || !previewContainer) return;

    previewContainer.innerHTML = "";

    this.pendingImages.forEach((imageData, index) => {
      const previewItem = document.createElement("div");
      previewItem.className = "image-preview-item";
      previewItem.innerHTML = `
        <img src="${imageData.data}" alt="Preview ${index + 1}">
        <button class="image-preview-remove" data-index="${index}">×</button>
      `;
      previewContainer.appendChild(previewItem);
    });

    const removeButtons = previewContainer.querySelectorAll(
      ".image-preview-remove"
    );
    removeButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const index = parseInt(e.target.getAttribute("data-index"));
        this.pendingImages.splice(index, 1);
        this.showImagePreviews();
      });
    });

    imageCounter.textContent = `${this.pendingImages.length} image${
      this.pendingImages.length !== 1 ? "s" : ""
    } selected`;

    modal.style.display = "block";
    document.body.style.overflow = "hidden";
  }

  closeImageModal() {
    const modal = document.getElementById("image-modal");
    if (modal) {
      modal.style.display = "none";
      document.body.style.overflow = "";
      this.pendingImages = [];
    }
  }

  sendImageMessage() {
    if (this.pendingImages.length === 0) return;

    const messageInput = document.getElementById("message-input");
    const caption = messageInput.value.trim();

    this.pendingImages.forEach((imageData, index) => {
      setTimeout(() => {
        this.socket.emit("send_message", {
          message: index === 0 ? caption : "",
          image: imageData.data,
        });
      }, index * 100);
    });

    messageInput.value = "";
    this.closeImageModal();
    this.handleInputChange();

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
    if (!container) return;

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
            messageData.message && messageData.message !== "Sent an image"
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
    const previewContainer = document.getElementById("image-preview-container");
    const actions = document.querySelector(".image-modal-actions");

    if (modal && modalImg) {
      modalImg.src = imageSrc;
      modal.style.display = "block";
      document.body.style.overflow = "hidden";

      if (previewContainer) previewContainer.style.display = "none";
      if (actions) actions.style.display = "none";
    }
  }

  displaySystemMessage(message) {
    const container = document.getElementById("messages-container");
    if (!container) return;

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
    navigator.clipboard.writeText(this.roomCode).then(() => {
      this.showToast();
    });
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

