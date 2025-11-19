class LandingPage {
  constructor() {
    this.init();
  }

  init() {
    this.setupParticles();
    this.setupSmoothScroll();
    this.setupAnimations();
  }

  setupParticles() {
    if (typeof particlesJS !== "undefined") {
      particlesJS("particles-js", {
        particles: {
          number: { value: 30, density: { enable: true, value_area: 500 } },
          color: { value: "#6366f1" },
          shape: { type: "circle" },
          opacity: { value: 0.3, random: true },
          size: { value: 2, random: true },
          line_linked: {
            enable: true,
            distance: 150,
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

  setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener("click", function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute("href"));
        if (target) {
          target.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      });
    });
  }

  setupAnimations() {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    }, observerOptions);

    document.querySelectorAll(".feature-card, .step").forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(20px)";
      el.style.transition = "opacity 0.6s ease, transform 0.6s ease";
      observer.observe(el);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new LandingPage();
});

