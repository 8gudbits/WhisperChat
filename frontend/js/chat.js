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
      this.previewPage = 0;
      this.imageZoom = {
        scale: 1,
        minScale: 0.5,
        maxScale: 5,
        lastX: 0,
        lastY: 0,
        isDragging: false,
        offsetX: 0,
        offsetY: 0,
      };
      this.currentImageIndex = 0;
      this.currentImageSet = [];
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
    this.setupImageZoom();
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
    const imagePreviewModal = document.getElementById("image-preview-modal");
    const modalClose = document.querySelectorAll(".image-modal-close");
    const sendImageBtn = document.getElementById("send-image-btn");
    const cancelImageBtn = document.getElementById("cancel-image-btn");

    copyBtn.addEventListener("click", () => this.copyRoomCode());
    actionBtn.addEventListener("click", () => this.handleActionButton());
    imageInput.addEventListener("change", (e) => this.handleImageSelect(e));

    modalClose.forEach((closeBtn) => {
      closeBtn.addEventListener("click", (e) => {
        const modal = e.target.closest(".image-modal");
        this.closeImageModal(modal);
      });
    });

    sendImageBtn.addEventListener("click", () => this.sendImageMessage());
    cancelImageBtn.addEventListener("click", () =>
      this.closeImageModal(imagePreviewModal)
    );

    messageInput.addEventListener("input", () => this.handleInputChange());

    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (e.shiftKey) {
          e.preventDefault();
          const start = messageInput.selectionStart;
          const end = messageInput.selectionEnd;
          messageInput.value =
            messageInput.value.substring(0, start) +
            "\n" +
            messageInput.value.substring(end);
          messageInput.selectionStart = messageInput.selectionEnd = start + 1;
          this.handleInputChange();
        } else {
          e.preventDefault();
          this.handleActionButton();
        }
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
        this.closeImageModal(imageModal);
      }
    });

    imagePreviewModal.addEventListener("click", (e) => {
      if (e.target === imagePreviewModal) {
        this.closeImageModal(imagePreviewModal);
      }
    });

    window.addEventListener("resize", () => {
      this.handleResize();
    });

    window.addEventListener("beforeunload", () => {
      this.leaveRoom();
    });

    document.addEventListener("keydown", (e) => {
      const imageModal = document.getElementById("image-modal");
      if (imageModal.style.display === "block") {
        if (e.key === "ArrowLeft") {
          this.previousImage();
        } else if (e.key === "ArrowRight") {
          this.nextImage();
        } else if (e.key === "Escape") {
          this.closeImageModal(imageModal);
        }
      }
    });
  }

  setupImageZoom() {
    const imageViewer = document.getElementById("image-viewer");
    const zoomableImage = document.getElementById("image-modal-img");
    const zoomInBtn = document.getElementById("zoom-in-btn");
    const zoomOutBtn = document.getElementById("zoom-out-btn");
    const resetZoomBtn = document.getElementById("reset-zoom-btn");
    const downloadBtn = document.getElementById("download-btn");
    const zoomLevel = document.getElementById("zoom-level");
    const prevBtn = document.getElementById("prev-image-btn");
    const nextBtn = document.getElementById("next-image-btn");

    if (!imageViewer || !zoomableImage) return;

    const constrainOffsets = () => {
      if (!zoomableImage.parentElement) return;

      const containerRect = imageViewer.getBoundingClientRect();
      const imageRect = zoomableImage.getBoundingClientRect();

      const maxOffsetX = Math.max(
        0,
        (imageRect.width - containerRect.width) / 2
      );
      const minOffsetX = -maxOffsetX;
      const maxOffsetY = Math.max(
        0,
        (imageRect.height - containerRect.height) / 2
      );
      const minOffsetY = -maxOffsetY;

      this.imageZoom.offsetX = Math.max(
        minOffsetX,
        Math.min(maxOffsetX, this.imageZoom.offsetX)
      );
      this.imageZoom.offsetY = Math.max(
        minOffsetY,
        Math.min(maxOffsetY, this.imageZoom.offsetY)
      );
    };

    const updateZoom = () => {
      zoomableImage.style.transform = `translate(${this.imageZoom.offsetX}px, ${this.imageZoom.offsetY}px) scale(${this.imageZoom.scale})`;
      zoomLevel.textContent = `${Math.round(this.imageZoom.scale * 100)}%`;

      constrainOffsets();
    };

    const resetZoom = () => {
      this.imageZoom.scale = 1;
      this.imageZoom.offsetX = 0;
      this.imageZoom.offsetY = 0;
      updateZoom();
      imageViewer.classList.remove("grabbing");
      this.imageZoom.isDragging = false;
    };

    zoomInBtn.addEventListener("click", () => {
      if (this.imageZoom.scale < this.imageZoom.maxScale) {
        this.imageZoom.scale = Math.min(
          this.imageZoom.scale + 0.25,
          this.imageZoom.maxScale
        );

        const oldScale = this.imageZoom.scale - 0.25;
        if (oldScale > 0) {
          const scaleRatio = this.imageZoom.scale / oldScale;
          this.imageZoom.offsetX *= scaleRatio;
          this.imageZoom.offsetY *= scaleRatio;
        }

        updateZoom();
      }
    });

    zoomOutBtn.addEventListener("click", () => {
      if (this.imageZoom.scale > this.imageZoom.minScale) {
        this.imageZoom.scale = Math.max(
          this.imageZoom.scale - 0.25,
          this.imageZoom.minScale
        );

        const oldScale = this.imageZoom.scale + 0.25;
        if (oldScale > 0) {
          const scaleRatio = this.imageZoom.scale / oldScale;
          this.imageZoom.offsetX *= scaleRatio;
          this.imageZoom.offsetY *= scaleRatio;
        }

        updateZoom();
      }
    });

    resetZoomBtn.addEventListener("click", resetZoom);

    downloadBtn.addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = "image.jpg";
      link.href = zoomableImage.src;
      link.click();
    });

    if (prevBtn) {
      prevBtn.addEventListener("click", () => this.previousImage());
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", () => this.nextImage());
    }

    imageViewer.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = imageViewer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldScale = this.imageZoom.scale;
      const newScale = Math.max(
        this.imageZoom.minScale,
        Math.min(this.imageZoom.maxScale, this.imageZoom.scale * zoomFactor)
      );

      if (newScale !== this.imageZoom.scale) {
        const scaleChange = newScale / this.imageZoom.scale;

        this.imageZoom.offsetX =
          mouseX - (mouseX - this.imageZoom.offsetX) * scaleChange;
        this.imageZoom.offsetY =
          mouseY - (mouseY - this.imageZoom.offsetY) * scaleChange;

        this.imageZoom.scale = newScale;
        updateZoom();
      }
    });

    imageViewer.addEventListener("mousedown", (e) => {
      if (this.imageZoom.scale > 1) {
        e.preventDefault();
        this.imageZoom.isDragging = true;
        this.imageZoom.lastX = e.clientX;
        this.imageZoom.lastY = e.clientY;
        imageViewer.classList.add("grabbing");
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (this.imageZoom.isDragging) {
        const deltaX = e.clientX - this.imageZoom.lastX;
        const deltaY = e.clientY - this.imageZoom.lastY;

        this.imageZoom.offsetX += deltaX;
        this.imageZoom.offsetY += deltaY;

        this.imageZoom.lastX = e.clientX;
        this.imageZoom.lastY = e.clientY;

        updateZoom();
      }
    });

    document.addEventListener("mouseup", () => {
      if (this.imageZoom.isDragging) {
        this.imageZoom.isDragging = false;
        imageViewer.classList.remove("grabbing");
      }
    });

    imageViewer.addEventListener("touchstart", (e) => {
      if (this.imageZoom.scale > 1 && e.touches.length === 1) {
        e.preventDefault();
        this.imageZoom.isDragging = true;
        this.imageZoom.lastX = e.touches[0].clientX;
        this.imageZoom.lastY = e.touches[0].clientY;
        imageViewer.classList.add("grabbing");
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        this.imageZoom.lastTouchDistance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
        );
      }
    });

    imageViewer.addEventListener("touchmove", (e) => {
      if (this.imageZoom.isDragging && e.touches.length === 1) {
        e.preventDefault();
        const deltaX = e.touches[0].clientX - this.imageZoom.lastX;
        const deltaY = e.touches[0].clientY - this.imageZoom.lastY;

        this.imageZoom.offsetX += deltaX;
        this.imageZoom.offsetY += deltaY;

        this.imageZoom.lastX = e.touches[0].clientX;
        this.imageZoom.lastY = e.touches[0].clientY;

        updateZoom();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const touchDistance = Math.hypot(
          touch1.clientX - touch2.clientX,
          touch1.clientY - touch2.clientY
        );

        if (this.imageZoom.lastTouchDistance) {
          const zoomFactor = touchDistance / this.imageZoom.lastTouchDistance;
          const newScale = Math.max(
            this.imageZoom.minScale,
            Math.min(this.imageZoom.maxScale, this.imageZoom.scale * zoomFactor)
          );

          if (newScale !== this.imageZoom.scale) {
            const rect = imageViewer.getBoundingClientRect();
            const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
            const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

            const scaleChange = newScale / this.imageZoom.scale;
            this.imageZoom.offsetX =
              centerX - (centerX - this.imageZoom.offsetX) * scaleChange;
            this.imageZoom.offsetY =
              centerY - (centerY - this.imageZoom.offsetY) * scaleChange;

            this.imageZoom.scale = newScale;
            updateZoom();
          }

          this.imageZoom.lastTouchDistance = touchDistance;
        }
      }
    });

    imageViewer.addEventListener("touchend", (e) => {
      if (e.touches.length === 0) {
        this.imageZoom.isDragging = false;
        this.imageZoom.lastTouchDistance = null;
        imageViewer.classList.remove("grabbing");
      } else if (e.touches.length === 1) {
        this.imageZoom.lastX = e.touches[0].clientX;
        this.imageZoom.lastY = e.touches[0].clientY;
      }
    });

    resetZoom();
  }

  previousImage() {
    if (this.currentImageSet.length <= 1) return;

    this.currentImageIndex =
      (this.currentImageIndex - 1 + this.currentImageSet.length) %
      this.currentImageSet.length;
    this.showImageAtIndex(this.currentImageIndex);
  }

  nextImage() {
    if (this.currentImageSet.length <= 1) return;

    this.currentImageIndex =
      (this.currentImageIndex + 1) % this.currentImageSet.length;
    this.showImageAtIndex(this.currentImageIndex);
  }

  showImageAtIndex(index) {
    const modalImg = document.getElementById("image-modal-img");
    const imageCounter = document.getElementById("image-counter");
    const prevBtn = document.getElementById("prev-image-btn");
    const nextBtn = document.getElementById("next-image-btn");

    if (modalImg && this.currentImageSet[index]) {
      modalImg.src = this.currentImageSet[index];
      this.currentImageIndex = index;

      if (imageCounter) {
        imageCounter.textContent = `${index + 1} / ${
          this.currentImageSet.length
        }`;
      }

      if (prevBtn) {
        prevBtn.style.display =
          this.currentImageSet.length > 1 ? "flex" : "none";
      }
      if (nextBtn) {
        nextBtn.style.display =
          this.currentImageSet.length > 1 ? "flex" : "none";
      }

      this.resetImageZoom();
    }
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

    const validImageFiles = files.filter((file) =>
      file.type.startsWith("image/")
    );

    if (validImageFiles.length === 0) {
      alert(
        "Please select valid image files (JPEG, PNG, GIF, WEBP, SVG, AVIF)."
      );
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
    const modal = document.getElementById("image-preview-modal");
    const previewContainer = document.getElementById("image-preview-container");
    const navContainer = document.getElementById("image-preview-nav");

    if (!modal || !previewContainer) return;

    if (this.pendingImages.length === 0) {
      this.closeImageModal(modal);
      return;
    }

    this.previewPage = this.previewPage || 0;
    const imagesPerPage = 1;
    const totalPages = Math.ceil(this.pendingImages.length / imagesPerPage);
    const startIndex = this.previewPage * imagesPerPage;
    const endIndex = Math.min(
      startIndex + imagesPerPage,
      this.pendingImages.length
    );
    const currentPageImages = this.pendingImages.slice(startIndex, endIndex);

    previewContainer.innerHTML = "";

    const container = document.createElement("div");
    container.className = "image-preview-container";

    currentPageImages.forEach((imageData, index) => {
      const globalIndex = startIndex + index;
      const previewItem = document.createElement("div");
      previewItem.className = "image-preview-item";
      previewItem.innerHTML = `
        <img src="${imageData.data}" alt="Preview ${globalIndex + 1}">
        <button class="image-preview-remove" data-index="${globalIndex}">×</button>
      `;
      container.appendChild(previewItem);
    });

    previewContainer.appendChild(container);

    const removeButtons = previewContainer.querySelectorAll(
      ".image-preview-remove"
    );
    removeButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        const index = parseInt(e.target.getAttribute("data-index"));
        this.pendingImages.splice(index, 1);

        if (
          this.previewPage > 0 &&
          this.pendingImages.length <= this.previewPage * imagesPerPage
        ) {
          this.previewPage = Math.max(0, this.previewPage - 1);
        }

        this.showImagePreviews();
      });
    });

    if (navContainer) {
      if (totalPages > 1) {
        navContainer.innerHTML = `
          <button class="nav-btn prev-btn ${
            this.previewPage === 0 ? "disabled" : ""
          }" 
                  ${this.previewPage === 0 ? "disabled" : ""}>
            ←
          </button>
          <span class="page-indicator">${
            this.previewPage + 1
          } / ${totalPages}</span>
          <button class="nav-btn next-btn ${
            this.previewPage === totalPages - 1 ? "disabled" : ""
          }" 
                  ${this.previewPage === totalPages - 1 ? "disabled" : ""}>
            →
          </button>
        `;

        const prevBtn = navContainer.querySelector(".prev-btn");
        const nextBtn = navContainer.querySelector(".next-btn");

        if (prevBtn) {
          prevBtn.addEventListener("click", () => {
            if (this.previewPage > 0) {
              this.previewPage--;
              this.showImagePreviews();
            }
          });
        }

        if (nextBtn) {
          nextBtn.addEventListener("click", () => {
            if (this.previewPage < totalPages - 1) {
              this.previewPage++;
              this.showImagePreviews();
            }
          });
        }

        navContainer.style.display = "flex";
      } else {
        navContainer.style.display = "none";
        navContainer.innerHTML = "";
      }
    }

    modal.style.display = "block";
    document.body.style.overflow = "hidden";
  }

  closeImageModal(modal) {
    if (modal) {
      modal.style.display = "none";
      document.body.style.overflow = "";
      if (modal.id === "image-preview-modal") {
        this.pendingImages = [];
        this.previewPage = 0;
      } else if (modal.id === "image-modal") {
        this.resetImageZoom();
        this.currentImageSet = [];
        this.currentImageIndex = 0;
      }
    }
  }

  resetImageZoom() {
    this.imageZoom.scale = 1;
    this.imageZoom.offsetX = 0;
    this.imageZoom.offsetY = 0;
    this.imageZoom.isDragging = false;

    const zoomableImage = document.getElementById("image-modal-img");
    const imageViewer = document.getElementById("image-viewer");
    const zoomLevel = document.getElementById("zoom-level");

    if (zoomableImage) {
      zoomableImage.style.transform = "translate(0, 0) scale(1)";
    }
    if (imageViewer) {
      imageViewer.classList.remove("grabbing");
    }
    if (zoomLevel) {
      zoomLevel.textContent = "100%";
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
    this.closeImageModal(document.getElementById("image-preview-modal"));
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
      const imageSrc = messageData.image.startsWith("data:")
        ? messageData.image
        : `data:image/jpeg;base64,${messageData.image}`;

      imageHtml = `
              <div class="message-image-container">
                  <img src="${imageSrc}" 
                      alt="Shared image" 
                      class="message-image"
                      onclick="chatRoom.showFullImageFromMessage('${imageSrc}', this)">
                  ${
                    messageData.message &&
                    messageData.message !== "Sent an image"
                      ? `<div class="message-image-caption">${this.escapeHtml(
                          messageData.message
                        )}</div>`
                      : ""
                  }
              </div>
          `;
    }

    const formattedMessage = this.linkifyWithNewlines(messageData.message);

    messageElement.innerHTML = `
          ${
            showUsername
              ? `<div class="message-username show">${this.escapeHtml(
                  messageData.username
                )}</div>`
              : '<div class="message-username"></div>'
          }
          <div class="message-bubble">
              ${messageData.image ? imageHtml : ""}
              ${
                !messageData.image && messageData.message
                  ? `<div class="message-content">${formattedMessage}</div>`
                  : ""
              }
              <div class="message-time">${time}</div>
          </div>
      `;

    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
  }

  linkifyWithNewlines(text) {
    if (!text) return "";

    const escapedText = this.escapeHtml(text);
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = escapedText.split(urlRegex);
    let result = "";

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        result += parts[i].replace(/\n/g, "<br>");
      } else {
        result += `<a href="${parts[i]}" target="_blank" rel="noopener noreferrer" class="message-link">${parts[i]}</a>`;
      }
    }

    return result;
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

  showFullImageFromMessage(imageSrc, clickedImage) {
    const messagesContainer = document.getElementById("messages-container");
    const allImages = [];
    const messageElements = messagesContainer.querySelectorAll(".message");

    messageElements.forEach((messageElement) => {
      const images = messageElement.querySelectorAll(".message-image");
      images.forEach((img) => {
        allImages.push(img.src);
      });
    });

    const startIndex = allImages.findIndex((src) => src === imageSrc);

    if (startIndex !== -1) {
      this.showFullImageWithNavigation(imageSrc, allImages, startIndex);
    } else {
      this.showFullImageWithNavigation(imageSrc, [imageSrc], 0);
    }
  }

  showFullImageWithNavigation(imageSrc, imageSet, startIndex = 0) {
    const modal = document.getElementById("image-modal");
    const modalImg = document.getElementById("image-modal-img");

    if (modal && modalImg) {
      this.currentImageSet = imageSet;
      this.currentImageIndex = startIndex;

      modalImg.src = imageSrc;
      modal.style.display = "block";
      document.body.style.overflow = "hidden";

      this.resetImageZoom();
      this.updateImageNavigation();
    }
  }

  updateImageNavigation() {
    const imageCounter = document.getElementById("image-counter");
    const prevBtn = document.getElementById("prev-image-btn");
    const nextBtn = document.getElementById("next-image-btn");

    if (imageCounter) {
      imageCounter.textContent = `${this.currentImageIndex + 1} / ${
        this.currentImageSet.length
      }`;
    }

    if (prevBtn) {
      prevBtn.style.display = this.currentImageSet.length > 1 ? "flex" : "none";
    }
    if (nextBtn) {
      nextBtn.style.display = this.currentImageSet.length > 1 ? "flex" : "none";
    }
  }

  showFullImage(imageSrc) {
    this.showFullImageWithNavigation(imageSrc, [imageSrc], 0);
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
}

let chatRoom;

document.addEventListener("DOMContentLoaded", () => {
  chatRoom = new ChatRoom();
});

