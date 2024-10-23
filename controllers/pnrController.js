import dotenv from 'dotenv';
import puppeteer from "puppeteer";
import fs from "fs";
import Tesseract from "tesseract.js";
import cron from "node-cron";
import isEmpty from 'lodash';
import twilio from 'twilio';


const cronJobs = {};
const pnrStatusCache = new Map();

dotenv.config()

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);


const intializeScrapper = async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      // args: ['--headless'],
    });
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(
      "https://www.indianrail.gov.in/enquiry/PNR/PnrEnquiry.html?locale=en",
      { waitUntil: "domcontentloaded" }
    );

    await page.reload({ waitUntil: "domcontentloaded" });

    return { page, browser };
  } catch (err) {
    page.close();
    browser.close();
    console.log("Scrapper intialization failed, Error:", err);
  }
};

const evaluateCaptcha = async (imagePath) => {
  try {
    const { data } = await Tesseract.recognize(imagePath, "eng");

    const rawExpression = data.text;

    const expression = rawExpression.substring(0, rawExpression.indexOf("="));

    const result = eval(expression);

    return result;
  } catch (error) {
    page.close();
    browser.close();
    console.error("Error during OCR:", error.message || error);
  }
};

const fillPNRDetails = async (page, pnrNo) => {
  try {
    await page.waitForSelector("#inputPnrNo");

    const pnrInput = await page.$("#inputPnrNo");
    await pnrInput.type(pnrNo);

    const pnrSubmitButton = await page.$("#modal1");
    await pnrSubmitButton.click();

    await page.waitForSelector("#CaptchaImgID");

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const imageElement = await page.$("#CaptchaImgID");

    if (!imageElement) {
      console.error("Image element not found!");
      return;
    }

    const boundingBox = await imageElement.boundingBox();

    const screenshot = await page.screenshot({
      clip: {
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
      },
    });

    fs.writeFileSync("captchaScreenshots/downloaded_image1.png", screenshot);

    const captchaResult = await evaluateCaptcha(
      "./captchaScreenshots/downloaded_image1.png"
    );

    const captchaResultInput = await page.$("#inputCaptcha");
    await captchaResultInput.type(String(captchaResult));

    const captchaSubmit = await page.$("#submitPnrNo");
    await captchaSubmit.click();
  } catch (err) {
    console.log("Error ocuured while filling form", err);
    page.close();
    browser.close();
  }
};

const readPNRDetailsTable = async (page) => {
  try {
    await page.waitForSelector("#journeyDetailsTable tbody");

    const journeyDeatils = await page.$eval("#journeyDetailsTable", (table) => {
      const tbodyElement = table.querySelector("tbody");

      if (tbodyElement) {
        const rows = tbodyElement.querySelectorAll("tr");

        const extractedData = Array.from(rows).map((row) => {
          const cells = row.querySelectorAll("td");
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
        page.close();
        browser.close();
        console.log("Tbody element not found.");
      }
    });

    // console.log(journeyDeatils);

    await page.waitForSelector("#psgnDetailsTable tbody");

    const passengerDeatils = await page.$eval("#psgnDetailsTable", (table) => {
      const tbodyElement = table.querySelector("tbody");

      if (tbodyElement) {
        const rows = tbodyElement.querySelectorAll("tr");

        const extractedData = Array.from(rows).map((row, i) => {
          const cells = row.querySelectorAll("td");
          return {
            passengerNo: cells[0].textContent.trim(),
            bookingStatus: cells[1].textContent.trim(),
            currentStatus: cells[2].textContent.trim(),
            coachPosition: cells[3].textContent.trim(),
          };
        });

        return extractedData;
      } else {
        console.log("Tbody element not found.");
      }
    });

    // console.log(passengerDeatils);

    await page.waitForSelector("#otherDetailsTable tbody");

    const otherDetails = await page.$eval("#otherDetailsTable", (table) => {
      const tbodyElement = table.querySelector("tbody");

      if (tbodyElement) {
        const rows = tbodyElement.querySelectorAll("tr");

        const extractedData = Array.from(rows).map((row, i) => {
          const cells = row.querySelectorAll("td");
          return {
            totalFare: cells[0].textContent.trim(),
            chartingStatus: cells[1].textContent.trim(),
          };
        });

        return extractedData[0];
      } else {
        console.log("Tbody element not found.");
      }
    });

    // console.log(otherDetails);

    return {
      ...journeyDeatils,
      passengerList: passengerDeatils,
      ...otherDetails,
    };
  } catch (err) {
    console.log("Error while reading pnr Table Error:", err);
  }
};

const commonPnrDeatilsFetcher = async (pnrNo) => {
  const { page, browser } = await intializeScrapper();

  await fillPNRDetails(page, pnrNo);

  const response = await readPNRDetailsTable(page);

  if (response) {
    page.close();
    browser.close();
    return response;
  }
};

const detectPnrChanges = (previousDetails, currentDetails) => {
  if (!previousDetails) return { hasChanged: true, changes: { initial: true } };

  const changes = {};
  let hasChanged = false;

  // Check journey details changes
  ['trainNumber', 'trainName', 'boardingDate', 'from', 'to', 'reservedUpto', 'boardingPoint', 'class'].forEach(field => {
    if (previousDetails[field] !== currentDetails[field]) {
      changes[field] = {
        from: previousDetails[field],
        to: currentDetails[field]
      };
      hasChanged = true;
    }
  });

  // Check passenger status changes
  if (previousDetails.passengerList?.length === currentDetails.passengerList?.length) {
    currentDetails.passengerList.forEach((passenger, index) => {
      const prevPassenger = previousDetails.passengerList[index];
      if (prevPassenger.currentStatus !== passenger.currentStatus ||
          prevPassenger.bookingStatus !== passenger.bookingStatus ||
          prevPassenger.coachPosition !== passenger.coachPosition) {
        changes[`passenger${index + 1}`] = {
          from: prevPassenger,
          to: passenger
        };
        hasChanged = true;
      }
    });
  } else {
    changes.passengerList = {
      from: previousDetails.passengerList,
      to: currentDetails.passengerList
    };
    hasChanged = true;
  }

  // Check charting status changes
  if (previousDetails.chartingStatus !== currentDetails.chartingStatus) {
    changes.chartingStatus = {
      from: previousDetails.chartingStatus,
      to: currentDetails.chartingStatus
    };
    hasChanged = true;
  }

  return { hasChanged, changes };
};


const formatWhatsAppMessage = (pnrDetails, pnrNo, changes) => {
  const message = 
   `🅿️PNR: ${Number(pnrNo)}
   
🚆Train No: ${Number(pnrDetails?.trainNumber)}
    
🪧Train Name: ${pnrDetails?.trainName}

🚦Date: ${pnrDetails?.boardingDate}

➡️From: ${pnrDetails?.from}
⬅️To: ${pnrDetails?.to}

🚋Class: ${pnrDetails?.class}

⚡Current Status: ${(pnrDetails?.passengerList).reduce((acc, curr, index) => acc + `\n🕵️‍♂️${index+1}: *${curr?.currentStatus}* [BS: ${curr?.bookingStatus}]`, "")}

💰Fare: ₹${Number(pnrDetails?.totalFare)}

📋Charting: *${pnrDetails?.chartingStatus}*

🚉Train Info: https://www.goibibo.com/trains/app/trainstatus/results/?train=${Number(pnrDetails?.trainNumber)}`;


  return message;
};

const sendWhatsAppMessage = async(pnrDetails, mobileNo, pnrNo, changes) => {
  try {
    console.log("Sending initialized", mobileNo);
    
    const message = formatWhatsAppMessage(pnrDetails, pnrNo, changes);
    
    const res = await client.messages.create({
      from: 'whatsapp:+14155238886',
      body: message,
      to: `whatsapp:${mobileNo}`
    });

    console.log("Message Sent successfully", res?.sid);
    
  } catch(err) {
    throw new Error("Error occurred while sending Message", err);
  }
};

const pnrSubScriber = async ({ pnrNo, mobileNo }) => {
  try {
    const currentDetails = await commonPnrDeatilsFetcher(pnrNo);
    
    if (currentDetails) {
      const previousDetails = pnrStatusCache.get(pnrNo);
      const { hasChanged, changes } = detectPnrChanges(previousDetails, currentDetails);

      if (hasChanged) {
        await sendWhatsAppMessage(currentDetails, mobileNo, pnrNo, changes);
        pnrStatusCache.set(pnrNo, currentDetails);
      } else {
        console.log(`No changes detected for PNR: ${pnrNo}`);
      }

      // Check if chart is prepared or all tickets are confirmed
      const isChartPrepared = currentDetails.chartingStatus.toLowerCase().includes('chart prepared');
      const isConfirmed = currentDetails.passengerList.every(passenger => 
        passenger.currentStatus.includes('CNF') || passenger.currentStatus.toLowerCase().includes('confirmed')
      );

      if (isChartPrepared || isConfirmed) {
        // Unsubscribe the PNR
        if (cronJobs[pnrNo]) {
          cronJobs[pnrNo].stop();
          delete cronJobs[pnrNo];
          pnrStatusCache.delete(pnrNo);
          console.log(`PNR ${pnrNo} unsubscribed due to ${isChartPrepared ? 'chart preparation' : 'all tickets confirmed'}.`);
          
          // Send a final message to inform the user
          // const finalMessage = `Your PNR ${pnrNo} has been unsubscribed as ${isChartPrepared ? 'the chart is prepared' : 'all tickets are confirmed'}. No further updates will be sent.`;
          // await sendWhatsAppMessage({...currentDetails, finalMessage}, mobileNo, pnrNo, changes);
        }
      }
    }

  } catch (err) {    
    throw new Error("Error from pnr subscriber");
  }
};

export const getPnrStatus = async (req, res) => {
  try {
    const pnrNo = req.query.pnrNo;

    const response = await commonPnrDeatilsFetcher(pnrNo);

    res.status(200).json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Internal Server Error While Getting PNR details" });
  }
};

export const subscribePnr = async (req, res) => {
  try {
    const { pnrNo, mobileNo, sheduleTimer } = req.body;

    console.log(pnrNo, mobileNo, sheduleTimer);

    // Check if the PNR is already subscribed
    if (cronJobs[pnrNo]) {
      return res.status(400).json({ error: `PNR NO: ${pnrNo} is already subscribed` });
    }

    // Clear any existing cache for this PNR
    pnrStatusCache.delete(pnrNo);

    cronJobs[pnrNo] = cron.schedule(`*/${Number(sheduleTimer) || 30} * * * *`, async () => {
      await pnrSubScriber({ pnrNo, mobileNo });
    });

    // Trigger initial check
    await pnrSubScriber({ pnrNo, mobileNo });

    res.status(201).json({msg: `PNR NO: ${pnrNo} subscribed successfully`});
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error While Subscribing PNR: " + err});
  }
};

export const stopSubscriber = async (req, res) => {
  const { pnrNo } = req.body;

  console.log({cronJobs});

  if (cronJobs[pnrNo]) {
    cronJobs[pnrNo].stop();
    pnrStatusCache.delete(pnrNo);
    res.status(200).json({msg: `Successfully Unsubscribe PNR NO: ${pnrNo}`});
  } else {
    res.status(404).json({ msg: `PNR NO: ${pnrNo} not found`});
  }
};
