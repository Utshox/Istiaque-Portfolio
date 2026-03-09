document.addEventListener('DOMContentLoaded', () => {
    // 1. Setup dynamic year in footer
    const yearSpan = document.getElementById('year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // 2. Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-link');

    mobileMenuBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });

    // Close mobile menu when clicking a link
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.add('hidden');
        });
    });

    // 3. Typing Animation for Sub-Headline
    const sentences = [
        "AI & Data Engineer",
        "Full-Stack Developer",
        "Technical SEO Specialist"
    ];
    let partIndex = 0;
    let part = 0;
    let offset = 0;
    let len = sentences.length;
    let forwards = true;
    let skipCount = 0;
    const skipDelay = 15;
    const speed = 70;

    // Typing function
    function typeEffect() {
        if (forwards) {
            if (offset >= sentences[part].length) {
                ++skipCount;
                if (skipCount == skipDelay) {
                    forwards = false;
                    skipCount = 0;
                }
            }
        } else {
            if (offset == 0) {
                forwards = true;
                part++;
                offset = 0;
                if (part >= len) {
                    part = 0;
                }
            }
        }

        let sub = sentences[part].substring(0, offset);
        if (skipCount == 0) {
            if (forwards) {
                offset++;
            } else {
                offset--;
            }
        }

        const typedTextElement = document.getElementById('typed-text');
        if (typedTextElement) {
            typedTextElement.textContent = sub;
        }
    }

    setInterval(typeEffect, speed);

    // 4. Scroll Reveal via Intersection Observer
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Add the animation class
                entry.target.classList.add('is-visible');
                // Optional: Stop observing once revealed
                // observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const fadeElements = document.querySelectorAll('.fade-in-section');
    fadeElements.forEach(el => observer.observe(el));

    // 5. Navbar blur background effect on scroll
    const header = document.querySelector('header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('shadow-lg');
            header.classList.replace('bg-slate-950/80', 'bg-slate-950/95');
        } else {
            header.classList.remove('shadow-lg');
            header.classList.replace('bg-slate-950/95', 'bg-slate-950/80');
        }
    });

    // 6. Testimonial Carousel Logic
    const slides = document.querySelectorAll('.testimonial-slide');
    const dots = document.querySelectorAll('#testimonial-dots button');
    let currentSlide = 0;
    let slideInterval;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.remove('active');
            dots[i].classList.remove('bg-accent', 'w-10');
            dots[i].classList.add('bg-slate-700', 'w-3');
            if (i === index) {
                slide.classList.add('active');
                dots[i].classList.add('bg-accent', 'w-10');
                dots[i].classList.remove('bg-slate-700', 'w-3');
            }
        });
        currentSlide = index;
    }

    function nextSlide() {
        const next = (currentSlide + 1) % slides.length;
        showSlide(next);
    }

    function startSlideShow() {
        slideInterval = setInterval(nextSlide, 7000); // Change slide every 7 seconds
    }

    function stopSlideShow() {
        clearInterval(slideInterval);
    }

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            stopSlideShow();
            showSlide(index);
            startSlideShow();
        });
    });

    if (slides.length > 0) {
        startSlideShow();
    }
});
