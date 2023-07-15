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
    const cocoSsd = require('@tensorflow-models/coco-ssd');
    const tfnode = require('@tensorflow/tfjs-node');
    const mobilenet = require('@tensorflow-models/mobilenet');
    const nsfwjs = require('nsfwjs')
    const toxicity = require('@tensorflow-models/toxicity');
    const poseDetection = require('@tensorflow-models/pose-detection');
    const movenetModel = poseDetection.SupportedModels.MoveNet;
    const movenetDetector = await poseDetection.createDetector(movenetModel);


    // Load the models for mobilenet and cocossd
    const model = await mobilenet.load();
    const cocoModel = await cocoSsd.load();
    const nsfwModel = await nsfwjs.load();
    console.log('Models Loaded');

    const app = express();
    app.use(bodyParser.urlencoded({
        limit: '25mb',
        extended: true
    }));

    app.disable('etag');


    // Get Request to /ping to monitor website
    app.get('/ping', async (req, res) => {
       res.status(200).send("Website is up and running..").end();
    })

    // Post request to /mobilenet uses MobileNet Model to classify the image 
    // Base64 as Input
    app.post('/mobilenet', async (req, res) => {
        try {
            const img = await tfnode.node.decodeImage(Buffer.from(req.body.url.replace(/^data:image\/\w+;base64,/, ""), 'base64'))
            const predictions = await model.classify(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // Post request to /nsfw uses Nsfwjs Model to classify the image 
    // Base64 as Input
    app.post('/nsfw', async (req, res) => {
        try {
            const img = await tfnode.node.decodeImage(Buffer.from(req.body.url.replace(/^data:image\/\w+;base64,/, ""), 'base64'))
            const predictions = await nsfwModel.classify(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // Post request to /coco path to get the results using Coco-ssd model
    // Base64 as Input
    app.post('/coco', async (req, res) => {
        try {
            const img = await tfnode.node.decodeImage(Buffer.from(req.body.url.replace(/^data:image\/\w+;base64,/, ""), 'base64'))
            const predictions = await cocoModel.detect(img);
            res.send(predictions).end();
            tfnode.dispose(img);
        } catch (err) {
            console.log(err);
            res.send("An exception occured while processing the request").end();
        }
    })

    // Post request to /toxicity path to get the results using toxicity model
    // Array and threshold as Input
    app.post('/toxicity', async (req, res) => {
        const threshold = req.body.threshold ? req.body.threshold : 0.9;
        try {         
            toxicity.load(threshold).then(model => {
                model.classify(req.body.sentences).then(predictions => {
                    // `predictions` is an array of objects, one for each prediction head,
                    // that contains the raw probabilities for each input along with the
                    // final prediction in `match` (either `true` or `false`).
                    // If neither prediction exceeds the threshold, `match` is `null`.
                    res.send(predictions).end();
               })
            })
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
