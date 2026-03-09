const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();

        // Construct absolute file URL
        const fileUrl = `file:///${path.resolve(__dirname, 'resume_template.html').replace(/\\/g, '/')}`;
        console.log(`Loading URL: ${fileUrl}`);

        await page.goto(fileUrl, { waitUntil: 'networkidle0' });

        const pdfPath = path.resolve(__dirname, 'Istiaque_Ahmed_Resume.pdf');
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
        });

        console.log(`PDF successfully saved to ${pdfPath}`);
        await browser.close();
    } catch (error) {
        console.error("Error generating PDF:", error);
        process.exit(1);
    }
})();
