/*
Image Classifier using TensorFlow 
This classifier uses MobileNet and Coco-ssd pre-trained Models 
Author: engageub
*/
const throng = require('throng')

// Defines the number of concurrent threads to run. 
// Default is set to 1 if WEB_CONCURRENCY is not defined.
const WORKERS = process.env.WEB_CONCURRENCY || 1;

const TOKEN = process.env.TOKEN || 1;

// Default port is set to 8080 if env.PORT is not defined.
const PORT = process.env.PORT || 8080;
const CACHE_MAX = parseInt(process.env.CACHE_MAX) || 5;
const CACHE_MAXSIZE = parseInt(process.env.CACHE_MAXSIZE) || 6;



throng({
    workers: WORKERS,
    lifetime: Infinity
}, start)



async function start() {

    // Load all the required assets/libraries 
    const express = require('express');
    const bodyParser = require("body-parser");
    //    const cocoSsd = require('@tensorflow-models/coco-ssd');
    const tfnode = require('@tensorflow/tfjs-node');
    const mobilenet = require('@tensorflow-models/mobilenet');
    const knnClassifier = require('@tensorflow-models/knn-classifier');
    const axios = require('axios');
    const base64 = require('base-64');
    const https = require('https');
    const LRU = require('lru-cache');

    const options = {
        max: CACHE_MAX,
        // for use with tracking overall storage size
        maxSize: CACHE_MAXSIZE,
        sizeCalculation: (value, key) => {
            return 1
        },
        maxAge: 1000 * 60 * 60
    }


    const cache = new LRU(options)



    let model = "";
    let tesseractLoaded = false;



    model = await mobilenet.load();




    // Load the models for mobilenet and cocossd
    //const cocoModel = await cocoSsd.load();
    console.log('Models Loaded');

    const app = express();
    app.use(bodyParser.urlencoded({
        limit: '10mb',
        extended: true
    }));

    //app.use(bodyParser.json());


    const {
        Client
    } = require('pg');

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });


    await client.connect();

    await new Promise((resolve, reject) => {
        client.query('CREATE TABLE IF NOT EXISTS images_table ( base64_image TEXT , description VARCHAR(255), CONSTRAINT PK_image PRIMARY KEY (base64_image));', (err, res) => {
            if (err) throw err;
            console.log("Table Created");
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        client.query('CREATE TABLE IF NOT EXISTS models_table ( description VARCHAR(255) , model TEXT, CONSTRAINT PK_description PRIMARY KEY (description));', (err, res) => {
            if (err) throw err;
            console.log("Table Created");
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        client.query('DELETE FROM images_table a using images_table b where a.description < b.description AND a.base64_image=b.base64_image', (err, res) => {
            if (err) throw err;
            console.log("Duplicates Deleted");
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        client.query('ALTER TABLE images_table DROP constraint IF EXISTS PK_image;', (err, res) => {
            if (err) throw err;
           // client.end();
            resolve();
        });
    });



    async function fetchData(url) {
        console.log(url);
        // const https = require('https');
        return await new Promise((resolve, reject) => {


            https.get(url, (res) => {
                let body = "";

                res.on("data", (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {
                    // console.log(body);

                    return resolve(body);
                });

            }).on("error", (error) => {
                console.error(error.message);
                reject();
            });

        });
    }


    async function postData(url, data) {

        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 15000
            }
            return new Promise((resolve, reject) => {
                const req = https.request(url, options, (res) => {
                    if (res.statusCode < 200 || res.statusCode > 299) {
                        //return reject(res.statusCode)
                        console.log(res.statusCode);
                    }
                    const body = [];
                    res.on('data', (chunk) => body.push(chunk));
                    res.on('end', () => {
                        const resString = Buffer.concat(body).toString();
                        resolve(resString);
                    })
                })

                req.on('error', (err) => {
                    console(err)
                })
                req.on('timeout', () => {
                    req.destroy();
                    console.log("Request time out")
                })
                req.write(data)
                req.end()
            })
        } catch (err) {
            console.log(err);

        }
    }



    //Upload all models to database
    async function uploadModelsToDatabase(url) {

        //Fetch the data from Github
        let remoteModels = [];

        let response = await fetchData(url);
        response = response.trim();
        let json = JSON.parse(response);
        remoteModels = Object.keys(json);


        //Fetch the models from database 
        let dbModels = new Set();
        /*
        let client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });

        client.connect();
        */

        await new Promise((resolve, reject) => {
            client.query("SELECT description from models_table;", (err, result) => {
                if (err) throw err;
                for (let row of result.rows) {
                    dbModels.add(row.description);
                }
              //  client.end();
                resolve(result);
            });
        })


        for (let i = 0; i < remoteModels.length; i++) {
            if (!dbModels.has(remoteModels[i])) {
                //Fetch the model from remote url
                let remoteModelUrl = json[remoteModels[i]];
                console.log(remoteModelUrl);
                let remoteModelJson = await fetchData(remoteModelUrl);
                remoteModelJson = remoteModelJson.trim();
                if (!remoteModelJson) {
                    continue;
                }
                remoteModelJson = remoteModelJson.replaceAll('""', '"');

                //Store the data to database
                /*
                let client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();
                */

                await new Promise((resolve, reject) => {
                    client.query("INSERT INTO models_table(description, model) VALUES('" + remoteModels[i] + "', '" + remoteModelJson + "');", (err, result) => {
                        if (err) throw err;
                      //  client.end();
                        resolve();
                    });
                })

            }

        }
        console.log("Models uploaded");

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



    /*

        // Get Request to root / uses MobileNet Model to classify the image 
        // URL as input
        app.get('/', async (req, res) => {
            try {
                if(!req.query.url){
                    res.send("Invalid Input").end();
                    return;
                }
                const result = await fetchData(req.query.url);
                const img = await tfnode.node.decodeImage(Buffer.from(await result.arrayBuffer()))
                const predictions = await model.classify(img);
                res.send(predictions).end();
                tfnode.dispose(img);
            } catch (err) {
                console.log(err);
                res.send("Exception occured while processing the request").end();
            }

        })


    */


    /*
        // Get Request to path /coco uses CocoSSD Model to classify the image
        // URL as input
        app.get('/coco', async (req, res) => {
            try {
                const result = await fetchData(req.query.url);
                const img = await tfnode.node.decodeImage(Buffer.from(await result.arrayBuffer()))
                const predictions = await cocoModel.detect(img);
                res.send(predictions).end();
                tfnode.dispose(img);
            } catch (err) {
                console.log(err);
                res.send("An exception occured while processing the request").end();
            }

        })
    */

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


    /*
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
    */

    // Post request to get the results using trained model
    // Description and Base64 as Input
    app.post('/mlPredict', async (req, res) => {

        if (!model) {
            model = await mobilenet.load();
        }

        let classifier = knnClassifier.create();
        let base64Image = "";

        try {
            req.body.input = JSON.parse(req.body.input);

            if (!req.body.input.description || req.body.input.description == undefined || req.body.input.description == "undefined") {
                res.send("Model does not exist").end();
                classifier.dispose();
                return;
            }

            //Dynamic loading of model based on description
            //If model exists in database, predict the image

            // Create the classifier
            let modelExists = false;

            // Check if the model exists in cache
            if (cache.has(req.body.input.description)) {
                modelExists = true;
                classifier.setClassifierDataset(Object.fromEntries(JSON.parse(cache.get(req.body.input.description)).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
            } else {

                // Load the model if it already exists
                /*
                let client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();
                */

                await new Promise((resolve, reject) => {
                    client.query("SELECT model from models_table where description='" + req.body.input.description + "' limit 1;", (err, result) => {
                        if (err) throw err;
                        if (result && result.rows && result.rows.length > 0) {
                            modelExists = true;
                            cache.set(req.body.input.description, result.rows[0].model);
                            classifier.setClassifierDataset(Object.fromEntries(JSON.parse(result.rows[0].model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        }
                      //  client.end();
                        resolve();
                    });
                })
            }

            if (!modelExists) {
                res.send("Model does not exist").end()
            } else {
                let labels = [];
                for (let i = 0; i < req.body.input.images.length; i++) {
                    base64Image = req.body.input.images[i].replace(/^data:image\/\w+;base64,/, "");
                    let imageBuffer = await Buffer.from(base64Image, 'base64');         
                    let img = await tfnode.node.decodeImage(imageBuffer);
                    imageBuffer = "";
                    let logits = await model.infer(img, true);
                    let predictions = await classifier.predictClass(logits);
                    labels.push(predictions.label);
                    tfnode.dispose(img);
                }
                res.send(labels).end();
            }

            classifier.dispose();
            tfnode.disposeVariables();

        } catch (err) {
            console.log(base64Image);
            console.log(err);
            classifier.dispose();
            tfnode.disposeVariables();
            res.send("An exception occured while processing the request").end();
        }
    })
    
    
      // Post request to get the results using trained model
    // Description and Base64 as Input
    app.post('/mlPredictTest', async (req, res) => {

        if (!model) {
            model = await mobilenet.load();
        }

        let classifier = knnClassifier.create();
        let base64Image = "";

        try {
            req.body.input = JSON.parse(req.body.input);

            if (!req.body.input.description || req.body.input.description == undefined || req.body.input.description == "undefined") {
                res.send("Model does not exist").end();
                classifier.dispose();
                return;
            }

            //Dynamic loading of model based on description
            //If model exists in database, predict the image

            // Create the classifier
            let modelExists = false;

            // Check if the model exists in cache
            if (cache.has(req.body.input.description)) {
                modelExists = true;
                classifier.setClassifierDataset(Object.fromEntries(JSON.parse(cache.get(req.body.input.description)).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
            } else {

                // Load the model if it already exists
                let client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();

                await new Promise((resolve, reject) => {
                    client.query("SELECT model from models_table where description='" + req.body.input.description + "' limit 1;", (err, result) => {
                        if (err) throw err;
                        if (result && result.rows && result.rows.length > 0) {
                            modelExists = true;
                            cache.set(req.body.input.description, result.rows[0].model);
                            classifier.setClassifierDataset(Object.fromEntries(JSON.parse(result.rows[0].model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        }
                        client.end();
                        resolve();
                    });
                })
            }

            if (!modelExists) {
                res.send("Model does not exist").end()
            } else {
                let labels = [];
                for (let i = 0; i < req.body.input.images.length; i++) {
                    base64Image = req.body.input.images[i].replace(/^data:image\/\w+;base64,/, "");
                    let imageBuffer = await Buffer.from(base64Image, 'base64');         
                    let img = await tfnode.node.decodeImage(imageBuffer);
                    imageBuffer = "";
                    let logits = await model.infer(img, true);
                    let predictions = await classifier.predictClass(logits);
                    labels.push(predictions.label);
                    tfnode.dispose(img);
                }
                res.send(labels).end();
            }

            classifier.dispose();
            tfnode.disposeVariables();

        } catch (err) {
            console.log(base64Image);
            console.log(err);
            classifier.dispose();
            tfnode.disposeVariables();
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

            client.query("DELETE from models_table where description='" + req.query.description + "';", (err, result) => {
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

        res.send("Images are being trained").end();

        if (!model) {
            model = await mobilenet.load();
        }

        let classifier = knnClassifier.create();
        let base64Image = "";

        try {

            req.body.input = JSON.parse(req.body.input);

            if (!req.body.input.description || req.body.input.description == undefined || req.body.input.description == "undefined") {
                classifier.dispose();
                return;
            }


            let modelExists = false;

            // Load the model if it already exists
            /*
            let client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();
            */

            await new Promise((resolve, reject) => {
                client.query("SELECT model from models_table where description='" + req.body.input.description + "' limit 1;", (err, result) => {
                    if (err) throw err;
                    for (let row of result.rows) {
                        modelExists = true;
                        classifier.setClassifierDataset(Object.fromEntries(JSON.parse(row.model).map(([label, data, shape]) => [label, tfnode.tensor(data, shape)])));
                        break;
                    }
                    //client.end();
                    resolve(result);
                });
            })


            for (let i = 0; i < req.body.input.images.length; i++) {
                base64Image = req.body.input.images[i].replace(/^data:image\/\w+;base64,/, "");
                let imageBuffer = await Buffer.from(base64Image, 'base64');         
                let img = await tfnode.node.decodeImage(imageBuffer);
                imageBuffer = "";
                let logits = await model.infer(img, true);
                tfnode.dispose(img);

                var answer = "";
                if (req.body.input.answers[i] == 1) {
                    answer = "Y";
                } else {
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

            }

            //Store the classifier data to database
            let jsonStr = JSON.stringify(Object.entries(classifier.getClassifierDataset()).map(([label, data]) => [label, Array.from(data.dataSync()), data.shape]));

            cache.set(req.body.input.description, jsonStr);

            if (jsonStr) {
                /*
                client = new Client({
                    connectionString: process.env.DATABASE_URL,
                    ssl: {
                        rejectUnauthorized: false
                    }
                });

                client.connect();
                */

                //If Model already exists in database, update the table else insert
                if (modelExists) {

                    client.query("UPDATE models_table SET model='" + jsonStr + "' where description='" + req.body.input.description + "';", (err, res) => {
                        if (err) throw err;
                    //    client.end();
                    });

                } else {

                    client.query("INSERT INTO models_table(description, model) VALUES('" + req.body.input.description + "', '" + jsonStr + "');", (err, res) => {
                        if (err) throw err;
                  //      client.end();
                    });

                }

            }

            classifier.dispose();
            tfnode.disposeVariables();

        } catch (err) {
            console.log(base64Image);
            console.log(err);
            //res.send("Exception occured while processing the request").end();
            classifier.dispose();
            tfnode.disposeVariables();
        }

    })


    //Update Models to GitHub
    app.get('/updateModelsToGitHub', async (req, res) => {

        if (TOKEN == 1) {
            res.send("Github token is not provided in the environment").end();
            return;
        }

        res.send("Upload initiated").end();

        //Get the contents from repository and store the list of models present

        let githubModels = new Map();

        let config = {
            method: "GET",
            url: "https://api.github.com/repos/engageaffli/Models/contents/",
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            }
        };

        await new Promise((resolve, reject) => {

            axios(config)
                .then(function(response) {
                  //  console.log(response);
                    let result = response.data;
                    for (let i = 0; i < result.length; i++) {
                        githubModels.set(result[i].name.replace(".txt", ""), result[i].sha);
                    }
                    //console.log(githubModels);
                    resolve();

                })
                .catch(function(error) {
                    console.log(error);
                    resolve();
                    return;
                });

        });



        //Fetch the models from database
        let dbModels = new Set();
        /*
        let client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });

        client.connect();
        */

        await new Promise((resolve, reject) => {
            client.query("SELECT description from models_table;", (err, result) => {
                if (err) throw err;
                for (let row of result.rows) {
                    dbModels.add(row.description);
                }
            //    client.end();
                resolve();
            });
        })

     //   console.log(dbModels);

        //For each model, get the json from db and update to github 
        let modelsMap = new Map();
        for (let description of dbModels) {

            /*
            client = new Client({
                connectionString: process.env.DATABASE_URL,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            client.connect();
            */

            await new Promise((resolve, reject) => {
                client.query("SELECT model from models_table where description='" + description + "';", async (err, result) => {
                    if (err) throw err;

                    let data = null;


                    if (githubModels.has(description)) {
                        data = JSON.stringify({
                            message: "txt file",
                            content: base64.encode(result.rows[0].model),
                            sha: githubModels.get(description)
                        });
                    } else {
                        data = JSON.stringify({
                            message: "txt file",
                            content: base64.encode(result.rows[0].model)
                        });
                    }


                    let config = {
                        method: "PUT",
                        url: "https://api.github.com/repos/engageaffli/Models/contents/" + description + ".txt",
                        headers: {
                            Authorization: `Bearer ${TOKEN}`,
                            "Content-Type": "application/json",
                        },
                        data: data,
                    };


                    await new Promise((resolve, reject) => {
                        axios(config)
                            .then(function(response) {
                                // console.log(response);
                                resolve();
                            })
                            .catch(function(error) {
                               // console.log(error);
                                resolve();
                            });
                    });
                  //  client.end();
                    resolve();
                });

            })
            modelsMap.set(description, encodeURI("https://raw.githubusercontent.com/engageaffli/Models/main/" + description + ".txt"));

        }
        let obj = Object.fromEntries(modelsMap);
        let jsonString = JSON.stringify(obj);

        let data = JSON.stringify({
            message: "txt file",
            content: base64.encode(jsonString),
            sha: githubModels.get("models.json")
        });

        config = {
            method: "PUT",
            url: "https://api.github.com/repos/engageaffli/Models/contents/models.json",
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                "Content-Type": "application/json",
            },
            data: data,
        };

        await new Promise((resolve, reject) => {
            axios(config)
                .then(function(response) {
                //      console.log(response);
                    resolve();
                })
                .catch(function(error) {
                    console.log(error);
                    resolve();
                });
        });



    })

    // Get Request to train images for a particular category
    // Category description as input
    app.get('/trainImages', async (req, res) => {

        res.send("Training the images for description: " + req.query.description).end();
        return;
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
                        let logits = await model.infer(img, true);

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
