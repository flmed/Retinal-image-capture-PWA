// References to the HTML elements
const video = document.getElementById('video');
const switchCameraBtn = document.querySelector('#switch-camera');
const clearBtn = document.querySelector('#clear-btn');
const canvas = document.getElementById('canvas');
const canvasView = document.getElementById('canvasView');
const output = document.getElementById('result');
const classificationOutput = document.getElementById('classificationResult');
const selectionOutput = document.getElementById('selectionResult');
const classifyBtn = document.getElementById('classify-btn');
const context = canvas.getContext('2d');
const contextView = canvasView.getContext('2d');
const enableButton = document.getElementById('enable');
const resultsDiv = document.getElementById('results');

// boolean variable to plug/unplug the object detection model
objDetUsage = false;
// thresholds and other default values
objDetectionThreshold = 0.9;
classificationThreshold = 0.5;
k = 3;
foundElementsThreshold = 5; // number of ODs to be found before showing the output
// boolean variable to handle the loading heading
firstTime = true;

// Output results style
output.style.display = 'flex';
output.style.flexWrap = 'wrap';
output.style.maxWidth = '1200px';
selectionOutput.style.display = 'flex';
selectionOutput.style.flexWrap = 'wrap';
selectionOutput.style.maxWidth = '1200px';

// extracted images data and related score
images = [];
scores = [];

// Keep track of the time of the last action
let lastActionTime = 0;
const delay = 200; // minimum amount of time to wait before extracting new frame in ms
found = 0;

// models' URL
const objectDetectionModelUrl = '../models/objectDetection/model.json';
const classifierModelUrl = '../models/classificationLight/model.json';
const pretrainedClassifierModelUrl = '../models/mobileNet/model.json';

// models' variables
let objectDetectionModel;
let classifierModel;
let pretrainedClassifierModel;

// Camera loading
navigator.mediaDevices.getUserMedia({ video: true })
	.then(function(stream) {
		video.srcObject = stream;
		video.play();

	})
	.catch(function(err) {
		console.log("An error occurred: " + err);
	});

console.log("Camera loaded");

// Click event listener to the switch camera button
switchCameraBtn.addEventListener('click', () => {
	console.log("Switching camera")
	const stream = video.srcObject;
	const track = stream.getTracks()[0];
	const deviceId = track.getSettings().deviceId;
	navigator.mediaDevices.enumerateDevices() // find the other camera device ID
		.then(devices => {
			const otherDevice = devices.find(device => device.kind === 'videoinput' && device.deviceId !== deviceId);
			if (otherDevice) { // Stop the current stream and get a new stream from the other camera device
				track.stop();
				navigator.mediaDevices.getUserMedia({ video: { deviceId: otherDevice.deviceId, torch: true} })
					.then(newStream => {
					video.srcObject = newStream;
				  })
					.catch(error => {
						console.error('Error switching camera:', error);
				  });
			  }
		})
		.catch(error => {
			console.error('Error enumerating devices:', error);
		});
});

// Restart the process, cleaning the data
clearBtn.addEventListener('click', () => {
	output.textContent = '';
	classificationOutput.textContent = '';
	selectionOutput.textContent = '';
	images = [];
	scores = [];
	found = 0;
	resultsDiv.style.display = 'none';
});

// Load the object detection model and classification models
async function loadModels() {
	objectDetectionModel = await tf.loadGraphModel(objectDetectionModelUrl);
	classifierModel = await tf.loadLayersModel(classifierModelUrl);
	pretrainedClassifierModel = await tf.loadLayersModel(pretrainedClassifierModelUrl);
}

loadModels();

// Set canvas size to match video dimensions once loaded
video.addEventListener('loadedmetadata', function() {
  canvasView.width = video.videoWidth;
  canvasView.height = video.videoHeight;
});

// when the object detection model is plugged, preprocess the image for the model, take the prediction,
// and displays and save it (with the score) if the object detection score is above the threshold and enough time has passed
async function detectObjects() {
	// once enough objects are located show the output
    if (found >= foundElementsThreshold) {
        resultsDiv.style.display = 'block';
		document.getElementById('objects').style.display='block';
		document.getElementById('selected').style.display='none';
		document.getElementById('finalResult').style.display='none';
    }
	if(objectDetectionModel != null) {
		if(!objDetUsage){
			contextView.clearRect(0, 0, canvasView.width, canvasView.height);
			contextView.drawImage(video, 0, 0, canvasView.width, canvasView.height);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			window.requestAnimationFrame(detectObjects);
			return
		}
		tf.engine().startScope()
		if(firstTime) // show loading banner
			document.getElementById('loading-overlay').style.display = 'flex';
		firstTime = false;
		console.log("Detecting..")
		try {
			// preprocess image
			const img = tf.browser.fromPixels(video)
			const resized = tf.image.resizeBilinear(img, [640, 480])
			const casted = resized.cast('int32')
			const expanded = casted.expandDims(0)
			// predict
			predictions = await objectDetectionModel.executeAsync(expanded);
			// when changing the model, check the values of the arrays give in output inside predictions
			score = await predictions[3].array()
			score = score[0][0]
			boxes = await predictions[1].array()
			boxes = boxes[0][0]
		}catch(e){
			console.log("Finished early")
			window.requestAnimationFrame(detectObjects)
			return
		}
		document.getElementById('loading-overlay').style.display = 'none';
		detections = []
		// shows the bbox if the object detection score is above the threshold
		if (score > objDetectionThreshold) {
			detections.push({
				class: "Optic disc",
				score: score,
				box: {
					yMin: boxes[0] * canvas.height,
					xMin: boxes[1] * canvas.width,
					yMax: boxes[2] * canvas.height,
					xMax: boxes[3] * canvas.width,
				},
			});
		}
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(video, 0, 0, 640, 480);
		contextView.clearRect(0, 0, canvasView.width, canvasView.height);
		contextView.drawImage(video, 0, 0, canvasView.width, canvasView.height);
		for (let i = 0; i < detections.length; i++) {
			xMin= detections[i]['box']["xMin"];
			yMin= detections[i]['box']["yMin"];
			xMax= detections[i]['box']["xMax"];
			yMax= detections[i]['box']["yMax"];
			const classIndex = detections[i].class;
			const className = 'Class ' + classIndex;
			const score = Math.round(detections[i].score * 100) / 100;
			contextView.beginPath();
			contextView.strokeStyle = 'red';
			contextView.fillText(className + ': ' + score, xMin, yMin > 10 ? yMin - 5 : yMin + 15);
			contextView.lineWidth = 2;
			contextView.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin)
			context.beginPath();
			context.fillStyle = '#FF0000';
			context.fillText(className + ': ' + score, xMin, yMin > 10 ? yMin - 5 : yMin + 15);
			context.strokeStyle = '#FF0000';
			context.lineWidth = 2;
			context.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
			// save the frame if above threshold and enough time passed
			if (detections[i].score > objDetectionThreshold) {
                found += 1;
				const currentTime = Date.now();
				if (currentTime - lastActionTime < delay) {
					console.log('Saving of frame skipped');
					break;
				}
				lastActionTime = currentTime;
				context.clearRect(0, 0, canvas.width, canvas.height);
				context.drawImage(video, 0, 0, 640, 480);
				// Crop the object from the canvas, display it and save it
				const cropped = document.createElement('canvas');
				const croppedCtx = cropped.getContext('2d');
				width = 80;
				height = 80;
				cropped.width = width;
				cropped.height = height;
				croppedCtx.drawImage(canvas, xMin, yMin, xMax - xMin, yMax - yMin, 0, 0, width, height);
				// display also the associated object detection score
				const score = document.createElement('p');
				score.textContent = `Class ${detections[i].class} (${detections[i].score.toFixed(2)})`;
				const deleteButton = document.createElement('button');
				// add the delete button
				deleteButton.textContent = "X";
			    deleteButton.addEventListener("click", function() {
					const index = Array.from(output.children).indexOf(newDiv);
					images.splice(index, 1);
					scores.splice(index, 1);
					newDiv.remove();
			  	});
				const newDiv = document.createElement('div');
				newDiv.appendChild(score);
				newDiv.appendChild(cropped);
				newDiv.appendChild(deleteButton);
				output.appendChild(newDiv);
				const imageData = croppedCtx.getImageData(0, 0, width, height);
				images.push(imageData)
				scores.push(detections[i].score)
			}
		}
		tf.engine().endScope()
		window.requestAnimationFrame(detectObjects)
	} else{
		console.log("Model null..");
		window.requestAnimationFrame(detectObjects);
	}
}

window.requestAnimationFrame(detectObjects); // allows to have a continuous execution

// Take the top k frames, takes the classification result and show the classification score below each image,
// and also the majority class
classifyBtn.onclick = async () => {
	if(classifierModel == null){
		console.log("Classifier not loaded yet..");
		return;
	}
	found = 0;
	const predictions = [];
	const pretrainedPredictions = []
	topKImages = findTopKValues(scores, k, images);
	topKScores = findTopKValues(scores, k, scores);
	for (let i = 0; i < topKImages.length; i++) {
		const image = topKImages[i];
		const prediction = await predict(image, classifierModel);
		const finetunedPrediction = await predict(image, pretrainedClassifierModel);
		pretrainedPredictions.push(finetunedPrediction);
		predictions.push(prediction);
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		canvas.width = image.width;
		canvas.height = image.height;
		ctx.putImageData(image, 0, 0);
		const score = document.createElement('p');
		score.textContent = `Class Optic Disc (${topKScores[i].toFixed(2)})`;
		const newDiv = document.createElement('div');
		const classificationScore = document.createElement('p');
		classificationScore.textContent = `Class (${prediction.class}) (${prediction.probability.toFixed(2)})`;
		// \nClass (${finetunedPrediction.class}) (${finetunedPrediction.probability.toFixed(2)})
		newDiv.appendChild(score);
		newDiv.appendChild(canvas);
		newDiv.appendChild(classificationScore)
		selectionOutput.appendChild(newDiv);
	}
	document.getElementById('objects').style.display='none';
	document.getElementById('selected').style.display='block';
	document.getElementById('finalResult').style.display='block';
	const majorityClass = getMajorityClass(predictions);
	const pretrainedMajorityClass = getMajorityClass(pretrainedPredictions);
	classificationOutput.innerHTML = `<span style="color: red">${majorityClass.class}</span>`;
	// \n Pretrained majority class: ${pretrainedMajorityClass.class}
};

// Takes the majority class and its probability (approximating it with the output of the sigmoid neuron),
// and return the majority class and probability score
function getMajorityClass(predictions) {
	const counts = { 'ODE': 0, 'not_ODE': 0 };
	const probabilities = { 'ODE': 0, 'not_ODE': 0 };
	for (let i = 0; i < predictions.length; i++) {
		const prediction = predictions[i];
		counts[prediction.class] += 1;
		probabilities[prediction.class] += prediction.probability;
	}
	const ODECount = counts['ODE'];
	const notODECount = counts['not_ODE'];
	const total = ODECount + notODECount;
	const ODEProbability = (probabilities['ODE']+ 1-probabilities['not_ODE']) / total;
	const notODEProbability = (probabilities['not_ODE']+1-probabilities['ODE']) / total;
	if (ODECount > notODECount) {
		return { class: 'ODE', probability: ODEProbability };
	} else {
		return { class: 'not_ODE', probability: notODEProbability };
	}
}

// preprocess the image for the classification, classify the image and uses the threshold set to obtain the result
// and the associated probability
async function predict(image, model) {
	const tensor = tf.browser.fromPixels(image);
	const normalizedTensor = tensor.div(tf.scalar(255));
	const resized = tf.image.resizeBilinear(normalizedTensor, [224, 224]);
	const expanded = resized.expandDims(0);
	const prediction = await model.predict(expanded).data();
	const nonODEProbability = parseFloat(prediction[0]);
	// probability flipped if belonging to the 0 class
	if (nonODEProbability > classificationThreshold) {
		return { class: 'not_ODE', probability: nonODEProbability };
	} else {
		return { class: 'ODE', probability: 1-nonODEProbability };
	}
}

// Function used to give in output the top k elements with the highest object detection score (same index)
function findTopKValues(scores, k, elements) {
	const copy = scores.slice();
	copy.sort((a, b) => b - a);
	const indices = copy.slice(0, k).map(value => scores.indexOf(value));
	const topElements = indices.map(index => elements[index]);
	return topElements;
}

// flip the flag to start/stop the object detection usage and set the background color and text content
enableButton.addEventListener('click', function() {
    objDetUsage = !objDetUsage;
	if(objDetUsage){
		enableButton.style.backgroundColor = 'red';
		enableButton.innerText = 'STOP';
	} else {
		enableButton.style.backgroundColor = 'green';
		enableButton.innerText = 'START';
	}
});
