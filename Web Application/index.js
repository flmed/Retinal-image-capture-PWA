// References to the HTML elements
const video = document.getElementById('video');
const switchCameraBtn = document.querySelector('#switch-camera');
const objectDetectionToggle = document.querySelector('#object-detection-toggle');
const modelStatusDiv = document.getElementById('model-status');
const canvas = document.getElementById('canvas');
const output = document.getElementById('result');
const classificationOutput = document.getElementById('classificationResult');
const selectionOutput = document.getElementById('selectionResult');
k = document.getElementById('k').value;
const classifyBtn = document.getElementById('classify-btn');
const clearBtn = document.getElementById('clear-btn');
const detectionRange = document.getElementById("threshold");
const classificationRange = document.getElementById("classificationThreshold");
const context = canvas.getContext('2d');
const outputDetectionRange = document.querySelector("output[for='threshold']");
const outputClassificationRange = document.querySelector("output[for='classificationThreshold']");
const uploadButton = document.getElementById('uploadVideoBtn');
const cleanButton = document.getElementById('cleanUploadVideoBtn');

// style for the output
output.style.display = 'flex';
output.style.flexWrap = 'wrap';
output.style.maxWidth = '1200px';
selectionOutput.style.display = 'flex';
selectionOutput.style.flexWrap = 'wrap';
selectionOutput.style.maxWidth = '1200px';

// boolean variable to plug/unplug the object detection model
objDetUsage = false;

// object detection threshold
outputDetectionRange.textContent = detectionRange.value;
detectionRange.addEventListener("input", () => {
	outputDetectionRange.textContent = detectionRange.value;
});

// classification thresholdd
outputClassificationRange.textContent = classificationRange.value;
classificationRange.addEventListener("input", () => {
	outputClassificationRange.textContent = classificationRange.value;
});

// extracted images data and related score
images = [];
scores = [];

// Keep track of the time of the last action
let lastActionTime = 0;
const delay = 200; // minimum amount of time to wait before extracting new frame (in ms)

// models' URL
const objectDetectionModelUrl = 'models/objectDetection/model.json';
const classifierModelUrl = 'models/classificationLight/model.json';
const pretrainedClassifierModelUrl = 'models/mobileNet/model.json';

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

// Function used to clean the uploaded video view, once finished
function cleanVideo(){
	uploadedVideo.removeEventListener('play', detectFrame);
	uploadedVideo.removeEventListener('loadedmetadata', loadMetadata);
	uploadedVideo.pause();
	uploadedVideo.src = "";
}

// Function used to refresh the page once the clean button is clicked (to reload camera usage)
function refresh(){
	window.location.reload();
}
cleanButton.addEventListener('click', refresh);

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

// Function used once the clean button is clicked
// It restarts the process, cleaning the data
clearBtn.addEventListener('click', () => {
	output.textContent = '';
	classificationOutput.textContent = '';
	selectionOutput.textContent = '';
	images = [];
	scores = [];
});

// Plug the object detection model when the correspondant toggle is on, unplug in the opposite case
objectDetectionToggle.addEventListener('change', () => {
	if (objectDetectionToggle.checked) {
		console.log('Object detection enabled');
		objDetUsage = true;
	} else {
		console.log('Object detection disabled');
		objDetUsage = false;
	}
});

/* UPLOADED VIDEO FROM FILESYSTEM - RELATED CODE */

const uploadedVideo = document.createElement('video');

// upload button listener
uploadButton.addEventListener('click', function() {
  	// Stop the camera
	const video = document.querySelector('video');
  	const stream = video.srcObject;
  	const tracks = stream.getTracks();
  	tracks.forEach(function(track) {
    	track.stop();
  	});
  	const input = document.getElementById('fileUpload');
  	const file = input.files[0];
   	const url = URL.createObjectURL(file);
  	uploadedVideo.controls = true;
  	uploadedVideo.src = url;
  	uploadedVideo.addEventListener('loadedmetadata', loadMetadata);
  	uploadedVideo.addEventListener('ended', cleanVideo);
});

// Once metadata of the video are loaded, adapt the canvas and play the video
function loadMetadata(){
	console.log("Loaded metadata..");
	canvas.width = uploadedVideo.videoWidth;
	canvas.height = uploadedVideo.videoHeight;
	uploadedVideo.play();
	uploadedVideo.addEventListener('play', detectFrame);
}

// Once the video is plaied
function detectFrame(){
	const context = document.getElementById('canvas').getContext('2d');
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(uploadedVideo, 0, 0,canvas.width, canvas.height);
	const frame = context.getImageData(0, 0, canvas.width, canvas.height);
	detectObjectsFromVideo(frame, uploadedVideo);
	requestAnimationFrame(detectFrame);
}


async function detectObjectsFromVideo(frame, video) {
	if(objectDetectionModel != null) {
		tf.engine().startScope()
		try {
			// preprocess image
			const img = tf.browser.fromPixels(frame)
			const casted = img.cast('int32')
			const expanded = casted.expandDims(0)
			// predict
			predictions = await objectDetectionModel.executeAsync(expanded);
			// when changing the model, check the values of the arrays give in output inside predictions
			score = await predictions[3].array()
			score = score[0][0]
			console.log(score)
			boxes = await predictions[1].array()
			boxes = boxes[0][0]
		}catch(e){
			console.log(e);
			console.log("Finished early");
			return
		}
		detections = []
		// shows the bbox if the object detection score is above the threshold
		if (score > detectionRange.value) {
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
		context.drawImage(video, 0, 0, canvas.width, canvas.height);
		for (let i = 0; i < detections.length; i++) {
			xMin= detections[i]['box']["xMin"];
			yMin= detections[i]['box']["yMin"];
			xMax= detections[i]['box']["xMax"];
			yMax= detections[i]['box']["yMax"];
			// show the actual box using style code
			const classIndex = detections[i].class;
			const className = 'Class ' + classIndex;
			const score = Math.round(detections[i].score * 100) / 100;
			context.beginPath();
			context.fillStyle = '#FFFF00';
			context.fillText(className + ': ' + score, xMin, yMin > 10 ? yMin - 5 : yMin + 15);
			context.strokeStyle = '#FFFF00';
			context.lineWidth = 10;
			context.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
			console.log(xMin, yMin, xMax, yMax);
			// save the frame if the object detection score is above the threshold and enough time is passed
			if (detections[i].score > detectionRange.value) {
				const currentTime = Date.now();
				if (currentTime - lastActionTime < delay) {
					console.log('Saving of frame skipped');
					break;
				}
				lastActionTime = currentTime;
				context.clearRect(0, 0, canvas.width, canvas.height);
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
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
	} else{
		console.log("Model null..");
	}
}

/* ----- */

// Load the object detection model and classification models
async function loadModels() {
	// object detection model
	objectDetectionModel = await tf.loadGraphModel(objectDetectionModelUrl);
	statusText = document.createElement('span');
	statusText.textContent = 'Object detection model loaded';
	modelStatusDiv.appendChild(statusText);
	checkmarkIcon = document.createElement('i');
	checkmarkIcon.className = 'fas fa-check-circle';
	checkmarkIcon.style.color = 'green';
	checkmarkIcon.style.fontSize = '24px';
	modelStatusDiv.appendChild(checkmarkIcon);
	const lineBreak = document.createElement('br');
	modelStatusDiv.appendChild(lineBreak);
	// classification model
	classifierModel = await tf.loadLayersModel(classifierModelUrl);
	statusText = document.createElement('span');
	statusText.textContent = 'Classification model loaded';
	modelStatusDiv.appendChild(statusText);
	checkmarkIcon = document.createElement('i');
	checkmarkIcon.className = 'fas fa-check-circle';
	checkmarkIcon.style.color = 'green';
	checkmarkIcon.style.fontSize = '24px';
	modelStatusDiv.appendChild(checkmarkIcon);
	modelStatusDiv.appendChild(lineBreak);
	// pretrained classifier (optional)
	pretrainedClassifierModel = await tf.loadLayersModel(pretrainedClassifierModelUrl);
	statusText = document.createElement('span');
	statusText.textContent = 'Pretrained classification model loaded';
	modelStatusDiv.appendChild(statusText);
	checkmarkIcon = document.createElement('i');
	checkmarkIcon.className = 'fas fa-check-circle';
	checkmarkIcon.style.color = 'green';
	checkmarkIcon.style.fontSize = '24px';
	modelStatusDiv.appendChild(checkmarkIcon);
}

loadModels();

// when the object detection model is plugged, preprocess the image for the model, take the prediction,
// and displays and save it (with the score) if the object detection score is above the threshold and enough time has passed
async function detectObjects() {
	if(objectDetectionModel != null) {
		if(!objDetUsage){
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(video, 0, 0, 640, 480);
			window.requestAnimationFrame(detectObjects);
			return
		}
		tf.engine().startScope()
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
		detections = []
		// shows the bbox if the object detection score is above the threshold
		if (score > detectionRange.value) {
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
		for (let i = 0; i < detections.length; i++) {
			xMin= detections[i]['box']["xMin"];
			yMin= detections[i]['box']["yMin"];
			xMax= detections[i]['box']["xMax"];
			yMax= detections[i]['box']["yMax"];
			// style instructions to show the bbox on the canvas
			const classIndex = detections[i].class;
			const className = 'Class ' + classIndex;
			const score = Math.round(detections[i].score * 100) / 100;
			context.beginPath();
			context.fillStyle = '#FF0000';
			context.fillText(className + ': ' + score, xMin, yMin > 10 ? yMin - 5 : yMin + 15);
			context.strokeStyle = '#FF0000';
			context.lineWidth = 2;
			context.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);
			// save the frame is obj det score > threshold and enough time passed
			if (detections[i].score > detectionRange.value) {
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
	k = document.getElementById('k').value;
	const predictions = [];
	const pretrainedPredictions = []
	// select k highest elements from the array (3rd argument) given the first array of related scores
	topKImages = findTopKValues(scores, k, images);
	topKScores = findTopKValues(scores, k, scores);
	// for each, predict
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
	// shows the output
	const majorityClass = getMajorityClass(predictions);
	const pretrainedMajorityClass = getMajorityClass(pretrainedPredictions);
	classificationOutput.innerHTML = `Majority class: ${majorityClass.class}`;
	// \n Pretrained majority class: ${pretrainedMajorityClass.class}
};

// Takes the majority class and its probability (approximated with the output of the sigmoid neuron),
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
	// probability flipped if from the other class
	if (nonODEProbability > classificationRange.value) {
		return { class: 'not_ODE', probability: nonODEProbability };
	} else {
		return { class: 'ODE', probability: 1-nonODEProbability };
	}
}

// Function used to give in output the top k elements (images/scores) with the highest object detection score (same index)
function findTopKValues(scores, k, elements) {
	const copy = scores.slice();
	copy.sort((a, b) => b - a);
	const indices = copy.slice(0, k).map(value => scores.indexOf(value));
	const topElements = indices.map(index => elements[index]);
	return topElements;
}
