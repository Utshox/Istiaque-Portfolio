document.addEventListener("DOMContentLoaded", () => {
    const year = document.getElementById("year");
    if (year) {
        year.textContent = new Date().getFullYear();
    }

    const menuToggle = document.getElementById("menu-toggle");
    const siteNav = document.getElementById("site-nav");

    if (menuToggle && siteNav) {
        menuToggle.addEventListener("click", () => {
            const isOpen = siteNav.classList.toggle("is-open");
            menuToggle.setAttribute("aria-expanded", String(isOpen));
        });

        siteNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                siteNav.classList.remove("is-open");
                menuToggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    const revealItems = document.querySelectorAll(".reveal");
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-visible");
            }
        });
    }, { threshold: 0.16 });

    revealItems.forEach((item) => revealObserver.observe(item));

    const roles = [
        "Technical SEO Audits",
        "Site Architecture",
        "Content Systems",
        "Organic Growth Strategy"
    ];

    const rotatingRole = document.getElementById("rotating-role");
    let roleIndex = 0;

    if (rotatingRole) {
        setInterval(() => {
            roleIndex = (roleIndex + 1) % roles.length;
            rotatingRole.textContent = roles[roleIndex];
        }, 2400);
    }

    const slides = Array.from(document.querySelectorAll(".testimonial-slide"));
    const controls = Array.from(document.querySelectorAll("#testimonial-controls button"));
    let activeSlide = 0;
    let slideTimer;

    function showSlide(index) {
        slides.forEach((slide, slideIndex) => {
            slide.classList.toggle("is-active", slideIndex === index);
        });

        controls.forEach((button, buttonIndex) => {
            button.classList.toggle("is-active", buttonIndex === index);
        });

        activeSlide = index;
    }

    function startTestimonials() {
        if (!slides.length || !controls.length) {
            return;
        }

        slideTimer = setInterval(() => {
            showSlide((activeSlide + 1) % slides.length);
        }, 6000);
    }

    if (slides.length === controls.length && slides.length > 0) {
        controls.forEach((button, index) => {
            button.addEventListener("click", () => {
                clearInterval(slideTimer);
                showSlide(index);
                startTestimonials();
            });
        });

        showSlide(0);
        startTestimonials();
    }
});
