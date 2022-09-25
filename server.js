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
    const knnClassifier = require('@tensorflow-models/knn-classifier');

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
        limit: '5mb',
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


    client.query('CREATE TABLE IF NOT EXISTS images_table ( base64_image TEXT , description VARCHAR(255), CONSTRAINT PK_image PRIMARY KEY (base64_image));', (err, res) => {
        if (err) throw err;
        console.log("Table Created");
    });


    client.query('CREATE TABLE IF NOT EXISTS models_table ( description VARCHAR(255) , model TEXT, CONSTRAINT PK_description PRIMARY KEY (description));', (err, res) => {
        if (err) throw err;
        console.log("Table Created");
    });


    client.query('DELETE FROM images_table a using images_table b where a.description < b.description AND a.base64_image=b.base64_image', (err, res) => {
        if (err) throw err;
        console.log("Duplicates Deleted");
    });


    client.query('ALTER TABLE images_table DROP constraint IF EXISTS PK_image;', (err, res) => {
        if (err) throw err;

        client.end();
    });



    async function fetchData(url) {
       
        const https = require('https');
      return await new Promise((resolve, reject) => {

            https.get(url,(res) => {
                let body = "";

                res.on("data", (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {

                    return resolve(body);
                });

           }).on("error", (error) => {
                console.error(error.message);
           });

       });
    } 


    //Upload all models to database
    async function uploadModelsToDatabase(url){

        //Fetch the data from Github
        let remoteModels = []; 

        let response = await fetchData(url);
        response=response.trim();
        let json = JSON.parse(response); 
        remoteModels = Object.keys(json); 
        

       //Fetch the models from database 
       let dbModels = new Set();
       let client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
        });

        client.connect();

        await new Promise((resolve, reject) => {
            client.query("SELECT description from models_table;", (err, result) => {
                if (err) throw err;
                for(let row of result.rows) {
                  dbModels.add(row.description);
                }
                client.end();
                resolve(result);
            });
       })


       for(let i=0;i<remoteModels.length;i++){
           if(!dbModels.has(remoteModels[i])){
               //Fetch the model from remote url
               let remoteModelUrl = json[remoteModels[i]];
               let remoteModelJson = await fetchData(remoteModelUrl);
               remoteModelJson = remoteModelJson.trim();
               remoteModelJson = remoteModelJson.replaceAll('""', '"');

               //Store the data to database
                let client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();

                await new Promise((resolve, reject) => {
                    client.query("INSERT INTO models_table(description, model) VALUES('" + remoteModels[i] + "', '" + remoteModelJson + "');", (err, result) => { 
                        if (err) throw err;
                        client.end();
                        resolve(result);
                    });
                })
 
           }

       }

    } 


    //Update every hour for any new models in remote url
   // setInterval(function(){
        uploadModelsToDatabase("https://raw.githubusercontent.com/engageaffli/Models/main/models.json");
  //  },3600000);

  
    //Load model from a custom url
    app.get('/uploadModel', (req, res) => {

     uploadModelsToDatabase(req.query.url);
     res.send("Model update is in progress. Please use the model after a minute").end();

   })



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
            res.send(text.trim()).end();
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
            res.send(text.trim()).end();
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

    // Post request to get the results using trained model
    // Description and Base64 as Input
    app.post('/mlPredict', async (req, res) => {

        let request = JSON.parse(req.body.input);
        let description = request.description;
        let images = request.images;
        let classifier = knnClassifier.create();
        request = "";

        try {
            //Dynamic loading of model based on description
            //If model exists in database, predict the image

            // Create the classifier
            let modelExists = false;

            // Load the model if it already exists
            let client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            await new Promise((resolve, reject) => {
                client.query("SELECT model from models_table where description='" + description + "' limit 1;", (err, result) => {
                    if (err) throw err;
                    for (let row of result.rows) {
                        modelExists = true;
                        classifier.setClassifierDataset(Object.fromEntries(JSON.parse(row.model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        break;
                    }
                    client.end();
                    resolve(result);
                });
            })

            if (!modelExists) {
                res.send("Model does not exist").end()
            } else {
               let labels = []; 
                for(let i=0;i<images.length;i++){
                    let img = await tfnode.node.decodeImage(Buffer.from(images[i].replace(/^data:image\/\w+;base64,/, ""), 'base64'))
                    let logits = await model.infer(img, 'conv_preds');
                    let predictions = await classifier.predictClass(logits);
                    labels.push(predictions.label);
                    tfnode.dispose(img);
                }
               res.send(labels).end(); 
            }

        classifier.dispose();

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
                    //     console.log(row.description);
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
                if (err) throw err;
                client.end();
            });
            res.send("Update completed").end();

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })


    // Get List of categories stored 
    app.get('/getCategories', async (req, res) => {
        try {
            var output = [];

            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("SELECT DISTINCT description from images_table where (description LIKE '%Please%' OR description LIKE '%select%' OR description LIKE '%click%');", (err, result) => {
                if (err) throw err;
                if (!result || result.rows.length == 0) {
                    res.send(" ").end();
                } else {
                    res.send(result.rows).end();
                }

                client.end();
            });

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })


    // Get List of Images for a particular category
    app.get('/listImages', async (req, res) => {
        try {
            var output = [];

            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("SELECT base64_image from images_table where description='" + req.query.description + "';", (err, result) => {
                if (err) throw err;
                if (!result || result.rows.length == 0) {
                    res.send(" ").end();
                } else {
                    res.send(result.rows).end();
                }

                client.end();
            });

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })
 

    // Delete Images based on description 
    app.get('/deleteImages', async (req, res) => {
        try {
            var output = [];

            const client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            client.query("DELETE from images_table where description='" + req.query.description + "';", (err, result) => {
                if (err) throw err;
                res.send("Images deleted for description " + req.query.description).end();

                client.end();
            });

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }
    })


    // Post request to train images immediately 
    // Description and Image as Input
    app.post('/trainImages', async (req, res) => {

        let request = JSON.parse(req.body.input);
        let description = request.description;
        let images = request.images;
        let answers = request.answers;
        let classifier = knnClassifier.create();
        request = "";

       res.send("Images are being trained").end();

        try {
            // Create the classifier
            let modelExists = false;

            // Load the model if it already exists
            let client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            await new Promise((resolve, reject) => {
                client.query("SELECT model from models_table where description='" + description + "' limit 1;", (err, result) => {
                    if (err) throw err;
                    for (let row of result.rows) {
                        modelExists = true;
                        classifier.setClassifierDataset(Object.fromEntries(JSON.parse(row.model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        break;
                    }
                    client.end();
                    resolve(result);
                });
            })


            for(let i=0; i<images.length;i++) {

                let img = await tfnode.node.decodeImage(Buffer.from(images[i].replace(/^data:image\/\w+;base64,/, ""), 'base64'))
                let logits = await model.infer(img, 'conv_preds');

                var answer = "";
                if(answers[i] == 1){
                   answer = "Y";
                }else{
                   answer = "N";
                }

                //Predict the image and store the weight only if it cannot recognize
                if (classifier.getNumClasses() > 0) {
                    let predictions = await classifier.predictClass(logits);
                    let label = predictions.label;
                    if (label != answer) {
                        classifier.addExample(logits, answer);
                      // console.log("labels are not equal"); 
                    } else {
                       //   console.log("Weights already calculated");
                        //  console.log(predictions);
                    }
                } else {
                  
                   await classifier.addExample(logits, answer);
                }


                await tfnode.dispose(img);
            }

            //Store the classifier data to database
            let jsonStr = JSON.stringify(Object.entries(classifier.getClassifierDataset()).map(([label, data]) => [label, Array.from(data.dataSync()), data.shape]));

            if (jsonStr) {
                client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();

                //If Model already exists in database, update the table else insert
                if (modelExists) {

                    client.query("UPDATE models_table SET model='" + jsonStr + "' where description='" + description + "';", (err, res) => {
                        if (err) throw err;
                        client.end();
                    });

                } else {

                    client.query("INSERT INTO models_table(description, model) VALUES('" + description + "', '" + jsonStr + "');", (err, res) => {
                        if (err) throw err;
                        client.end();
                    });

                }

            }

        classifier.dispose();

        } catch (err) {
            console.log(err);
            res.send("Exception occured while processing the request").end();
        }

    })


    // Get Request to train images for a particular category
    // Category description as input
    app.get('/trainImages', async (req, res) => {

        res.send("Training the images for description: " + req.query.description).end();
        try {
            // Create the classifier
            let modelExists = false;
            let classifier = knnClassifier.create();
 
            // Load the model if it already exists
            let client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            await new Promise((resolve, reject) => {
                client.query("SELECT model from models_table where description='" + req.query.description + "' limit 1;", (err, result) => {
                    if (err) throw err;
                    for (let row of result.rows) {
                        modelExists = true;
                        classifier.setClassifierDataset(Object.fromEntries(JSON.parse(row.model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        break;
                    }
                    client.end();
                    resolve(result);
                });
            })

            //Get the images from database to train the model
            let jsonStr = "";

            client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();

            await new Promise((resolve, reject) => {

                client.query("SELECT base64_image from images_table where description='" + req.query.description + "' limit 500;", async (err, result) => {
                    if (err) throw err;
                    for (let row of result.rows) {
                        let img = await tfnode.node.decodeImage(Buffer.from(row.base64_image.replace(/^data:image\/\w+;base64,/, ""), 'base64'))
                        let logits = await model.infer(img, 'conv_preds');

                        //Predict the image and store the weight only if it cannot recognize
                        //console.log(logits);

/*
                        if (classifier.getNumClasses() > 0) {
                            let predictions = await classifier.predictClass(logits);
                            let score = predictions.confidences[req.query.description];
                            if (score != 1) {
                                classifier.addExample(logits, req.query.description);
                                console.log("score is::" + score);
                            } else {
                                //  console.log("Weights already calculated");
                                //   console.log(predictions);
                            }
                        } else {
*/
                            classifier.addExample(logits, req.query.description);
                   //     }
                        tfnode.dispose(img);
                    }

                    //Store the classifier data to database
                    jsonStr = JSON.stringify(Object.entries(classifier.getClassifierDataset()).map(([label, data]) => [label, Array.from(data.dataSync()), data.shape]));

                    client.end();
                    resolve(result)
                });

            })

            if (jsonStr) {
                client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();

                //If Model already exists in database, update the table else insert
                if (modelExists) {

                    client.query("UPDATE models_table SET model='" + jsonStr + "' where description='" + req.query.description + "';", (err, res) => {
                        if (err) throw err;
                        client.end();
                    });

                } else {

                    client.query("INSERT INTO models_table(description, model) VALUES('" + req.query.description + "', '" + jsonStr + "');", (err, res) => {
                        if (err) throw err;
                        client.end();
                    });

                }

            }
         classifier.dispose();


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