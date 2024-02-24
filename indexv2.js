import puppeteer from "puppeteer";
import fs from "fs";
import Tesseract from "tesseract.js";


const evaluateCaptcha = async (imagePath) => {
  try {
    const { data } = await Tesseract.recognize(imagePath, "eng");

    const rawExpression = data.text;

    const expression = rawExpression.substring(0, rawExpression.indexOf("="));

    const result = eval(expression);

    return result;
  } catch (error) {
    console.error("Error during OCR:", error.message || error);
  }
};

const scrapPnrDetailsTable = async (page) => {

  await page.waitForSelector("#journeyDetailsTable tbody");
  
  const journeyDeatils = await page.$eval('#journeyDetailsTable', table => {

    const tbodyElement = table.querySelector('tbody');
  
    if (tbodyElement) {
      const rows = tbodyElement.querySelectorAll('tr');

      const extractedData = Array.from(rows).map(row => {
        const cells = row.querySelectorAll('td');
        return {
          // Your hardcoded key-value pairs:
          trainNumber: cells[0].textContent.trim(),
          trainName: cells[1].textContent.trim(),
          boardingDate: cells[2].textContent.trim(),
          from: cells[3].textContent.trim(),
          to: cells[4].textContent.trim(),
          reservedUpto: cells[5].textContent.trim(),
          boardingPoint: cells[6].textContent.trim(),
          class: cells[7].textContent.trim(),
        };
      });
    
      return extractedData[0];
    } else {
      console.log('Tbody element not found.');
    }
  });

  console.log(journeyDeatils);

  await page.waitForSelector("#psgnDetailsTable tbody");

  const passengerDeatils = await page.$eval('#psgnDetailsTable', table => {

    const tbodyElement = table.querySelector('tbody');
  
    if (tbodyElement) {
      const rows = tbodyElement.querySelectorAll('tr');

      const extractedData = Array.from(rows).map((row, i) => {
        const cells = row.querySelectorAll('td');
        return {
          passengerNo: cells[0].textContent.trim(),
          bookingStatus: cells[1].textContent.trim(),
          currentStatus: cells[2].textContent.trim(),
          coachPosition: cells[3].textContent.trim(),
        };
      });
    
      return extractedData;
    } else {
      console.log('Tbody element not found.');
    }
  });

  console.log(passengerDeatils);

  await page.waitForSelector("#otherDetailsTable tbody");

  const otherDetails = await page.$eval('#otherDetailsTable', table => {

    const tbodyElement = table.querySelector('tbody');
  
    if (tbodyElement) {
      const rows = tbodyElement.querySelectorAll('tr');

      const extractedData = Array.from(rows).map((row, i) => {
        const cells = row.querySelectorAll('td');
        return {
          totalFare: cells[0].textContent.trim(),
          chartingStatus: cells[1].textContent.trim(),
        };
      });
    
      return extractedData[0];
    } else {
      console.log('Tbody element not found.');
    }
  });

  console.log(otherDetails);

  
};

const scrapPage = async (pnrNo) => {
  let browser = await puppeteer.launch({
    headless: false,
    // args: ['--headless'],
  });
  const page = await browser.newPage();

  await page.setViewport({ width: 1920, height: 1080 });

  try {
    await page.goto(
      "https://www.indianrail.gov.in/enquiry/PNR/PnrEnquiry.html?locale=en"
    );

    const pnrInput = await page.$("#inputPnrNo");
    await pnrInput.type(pnrNo);

    const pnrSubmitButton = await page.$("#modal1");
    await pnrSubmitButton.click();

    await page.waitForSelector("#CaptchaImgID");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const imageElement = await page.$("#CaptchaImgID");

    // Check if the image element exists
    if (!imageElement) {
      console.error("Image element not found!");
      return;
    }

    // Get the image bounding box
    const boundingBox = await imageElement.boundingBox();

    // Take a screenshot of the image area
    const screenshot = await page.screenshot({
      clip: {
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      },
    });

    fs.writeFileSync("downloaded_image1.png", screenshot);

    const captchaResult = await evaluateCaptcha("./downloaded_image1.png");

    if (captchaResult) {
      const captchaResultInput = await page.$("#inputCaptcha");
      await captchaResultInput.type(String(captchaResult));

      const captchaSubmit = await page.$("#submitPnrNo");
      await captchaSubmit.click();

      await scrapPnrDetailsTable(page);
    }
  } catch (err) {
    console.log(err);
  }
};

scrapPage("8714634455");
