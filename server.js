/*
Image Classifier using TensorFlow 
This classifier uses MobileNet and Coco-ssd pre-trained Models 
Author: engageub
*/

const throng = require('throng')

// Defines the number of concurrent threads to run. 
// Default is set to 1 if WEB_CONCURRENCY is not defined.
const WORKERS = process.env.WEB_CONCURRENCY || 1;

// Default port is set to 8080 if env.PORT is not defined.
const PORT = process.env.PORT || 8080;

throng({
    workers: WORKERS,
    lifetime: Infinity
}, start)

async function start() {

    // Load all the required assets/libraries 
    const express = require('express');
    const bodyParser = require("body-parser");
    require('@tensorflow/tfjs-backend-cpu');
    require('@tensorflow/tfjs-backend-webgl');
    const cocoSsd = require('@tensorflow-models/coco-ssd');
    const tf = require('@tensorflow/tfjs');
    const tfnode = require('@tensorflow/tfjs-node');
    const mobilenet = require('@tensorflow-models/mobilenet');
    const {
        createWorker
    } = require('tesseract.js');
    const fetch = require('node-fetch');


    // Load the models for mobilenet and cocossd
    const model = await mobilenet.load();
    const cocoModel = await cocoSsd.load();
    console.log('Models Loaded');

    const app = express();
    app.use(bodyParser.urlencoded({
        extended: true
    }));


    // Get Request to path /ocr uses Tesseract 
    // URL as input
    app.get('/ocr', (req, res) => {
        const image_url = req.query.url;
        const worker = createWorker();
        (async() => {
            await worker.load();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            const {
                data: {
                    text
                }
            } = await worker.recognize(image_url);
            await worker.terminate();
            res.send(text).end();
        })();
    })

    // Post Request to path /ocr uses Tesseract
    // URL or Base64 as input
    app.post('/ocr', (req, res) => {
        const image_url = req.body.url;
        const worker = createWorker();
        (async() => {
            await worker.load();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            const {
                data: {
                    text
                }
            } = await worker.recognize(image_url);
            await worker.terminate();
            res.send(text).end();
        })();
    })

    // Get Request to root / uses MobileNet Model to classify the image 
    // URL as input
    app.get('/', async(req, res) => {
        try {
            const result = await fetch(req.query.url);
            const img = await tfnode.node.decodeImage(Buffer.from(await result.arrayBuffer()))
            const predictions = await model.classify(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }

    })

    // Get Request to path /coco uses CocoSSD Model to classify the image
    // URL as input
    app.get('/coco', async(req, res) => {
        try {
            const result = await fetch(req.query.url);
            const img = await tfnode.node.decodeImage(Buffer.from(await result.arrayBuffer()))
            const predictions = await cocoModel.detect(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("An exception occured while processing the request").end();
        }

    })

    // Post request to root / uses MobileNet Model to classify the image 
    // Base64 as Input
    app.post('/', async(req, res) => {
        try {
            const img = await tfnode.node.decodeImage(Buffer.from(req.body.url, 'base64'))
            const predictions = await model.classify(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // Post request to /coco path to get the results using Coco-ssd model
    // Base64 as Input
    app.post('/coco', async(req, res) => {
        try {
            const img = await tfnode.node.decodeImage(Buffer.from(req.body.url, 'base64'))
            const predictions = await cocoModel.detect(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("An exception occured while processing the request").end();
        }
    })

    // App listening port
    app.listen(PORT, () => {
        console.log(`App listening on port ${PORT}`);
        console.log('Press Ctrl+C to quit.');
    });
}
