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

    const {
        Client
    } = require('pg');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });


    client.connect();
    
    // Create table if it does not exist
    client.query('CREATE TABLE IF NOT EXISTS images_table ( base64_image TEXT , description VARCHAR(255), CONSTRAINT PK_image PRIMARY KEY (base64_image));', (err, res) => {
        if (err) throw err;
        console.log("Table Created");
    });

    // Remove constraint if present to avoid indexing memory limitation
    client.query('ALTER TABLE images_table DROP constraint IF EXISTS PK_image;', (err, res) => {
        if (err) throw err;
    });

    client.end();

    // Get Request to path /ocr uses Tesseract 
    // URL as input
    app.get('/ocr', (req, res) => {
        const image_url = req.query.url;
        const worker = createWorker();
        (async () => {
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
        (async () => {
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
    app.get('/', async (req, res) => {
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
    app.get('/coco', async (req, res) => {
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
    app.post('/', async (req, res) => {
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
    app.post('/coco', async (req, res) => {
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

    // Post request to retrieve image description from database
    // Base64 as Input
    app.post('/getImageData', async (req, res) => {
        try {
            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("select description from images_table where base64_image='" + req.body.url + "' limit 1;", (err, result) => {
                if (err) throw err;
                for (let row of result.rows) {
                    console.log(row.description);
                    res.send(row.description).end();
                    break;
                }
                if (!result || result.rows.length == 0) {
                    res.send(" ").end();
                }
                client.end();
            });

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // Post request to store image data to  database
    // Base64 as Input
    app.post('/putImageData', async (req, res) => {
        try {
            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("INSERT INTO images_table(base64_image, description) VALUES('" + req.body.url + "', '" + req.body.description + "');", (err, res) => {
                if (err) throw err;
                client.end();
            });

            res.send("Insert completed").end();

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // Post request to update image data to  database
    // Base64 as Input
    app.post('/updateImageData', async (req, res) => {
        try {

            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("UPDATE images_table SET description='" + req.body.description + "' where base64_image='" + req.body.url + "';", (err, res) => {
                if (err) throw err
                client.end();
            });
            res.send("Update completed").end();

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })

    // App listening port
    app.listen(PORT, () => {
        console.log(`App listening on port ${PORT}`);
        console.log('Press Ctrl+C to quit.');
    });


}
