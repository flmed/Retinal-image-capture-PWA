let mediaStream = null; // To hold the camera stream

// --- Application State ---
let currentPage = 1;
let currentEye = 'RIGHT'; // Default to RIGHT (OD)
let capturedImages = []; 
// MODIFICATION: Add operatorId to subjectInfo
let subjectInfo = { operatorId: '', id: '', notes: '' };
let isSelectionMode = false;
let isAutoCaptureActive = false; // Renamed from isOdDetectionOn
let autoCaptureInterval = null; 
const MAX_CAROUSEL_IMAGES = 5;

// TensorFlow.js model variables
let objectDetectionModel = null;
let classifierModel = null;
let pretrainedClassifierModel = null;
const objectDetectionModelUrl = 'models/objectDetection/model.json';
const classifierModelUrl = 'models/classificationLight/model.json';
const pretrainedClassifierModelUrl = 'models/mobileNet/model.json';

// NEW: DOM Elements for Model Status on Info Page
let objDetStatusIcon;
let objDetStatusText;
let objDetProgressBar;
let classifierStatusIcon;
let classifierStatusText;
let classifierProgressBar;
// NEW: Combined Status Elements
let combinedStatusIcon; // The new large spinning disc
let overallStatusText; // The new "Loading Models..." text

// NEW: Model Status Constants
const STATUS = {
    RED: { icon: 'fa-times-circle', color: 'red', text: 'ERROR' },
    ORANGE: { icon: 'fa-circle-notch fa-spin', color: 'orange', text: 'Loading...' },
    GREEN: { icon: 'fa-check-circle', color: 'green', text: 'Loaded' }
};

// --- NEW: Object Detection Loop (replaces fake auto capture) ---
let lastActionTime = 0;
const detectionDelay = 300; // Minimum ms between saved frames
const detectionThreshold = 0.8; // Customize if needed
let detectionActive = false;
let isOdDetectionVisible = false;
let detectionFrameId = null; // To hold the requestAnimationFrame ID

// NEW: Counters for automatic naming
let manualLeftCount = 0;
let manualRightCount = 0;
let autoLeftCount = 0;
let autoRightCount = 0;

// MODIFICATION: New state for camera options
let availableCameras = [];
let currentDeviceId = null;
let isTorchOn = true; // Default torch ON behavior

// Lightbox state
let lightboxImageSetet = [];
let lightboxCurrentIndex = 0;

// MODIFICATION: New state to store analysis and TLX results
let analysisResults = { 
    left: 'Awaiting classification...', 
    right: 'Awaiting classification...', 
    leftClass: '', 
    rightClass: '' 
};
const CLASSIFICATION_THRESHOLD = 0.5;
const TOP_K_IMAGES = 5;

let tlxAnswers = {};

// Official NASA TLX Questions
const TLX_DIMENSIONS = [
    { name: "Mental Demand", prompt: "How mentally demanding was the task?" },
    { name: "Physical Demand", prompt: "How physically demanding was the task?" },
    { name: "Temporal Demand", prompt: "How hurried or rushed was the pace of the task?" },
    { name: "Performance", prompt: "How successful were you in accomplishing what you were asked to do?" },
    { name: "Effort", prompt: "How hard did you have to work to accomplish your level of performance?" },
    { name: "Frustration", prompt: "How insecure, discouraged, irritated, stressed, or annoyed were you?" },
];

// --- Utility ---
function alertUser(message, isError = false) {
    console.log(`UI Alert (${isError ? 'ERROR' : 'INFO'}): ${message}`);
}

function customConfirm(message) {
    return window.confirm(message); 
}

// --- Paging & Navigation ---

function updateStepNav() {
    document.querySelectorAll('#step-nav .step').forEach(step => {
        const stepNum = parseInt(step.getAttribute('data-step'));
        step.classList.remove('current');
        if (stepNum === currentPage) {
            step.classList.add('current');
        }
        step.onclick = () => {
            navigateTo(stepNum);
        };
    });
}

function validateStep1() {
    // MODIFICATION: Add Operator ID validation
    const operatorIdInput = document.getElementById('operatorId');
    const operatorId = operatorIdInput.value.trim();
    if (!operatorId) {
        alertUser('Please enter an Operator ID before continuing.', true);
        operatorIdInput.focus();
        return false;
    }
    
    const subjectIdInput = document.getElementById('subjectId');
    const subjectId = subjectIdInput.value.trim();
    if (!subjectId) {
        alertUser('Please enter a Subject ID before continuing.', true);
        subjectIdInput.focus();
        return false;
    }
    
    // Store both IDs
    subjectInfo.operatorId = operatorId;
    subjectInfo.id = subjectId;
    return true;
}

/**
 * Grabs the necessary DOM elements for status display on the Info Page.
 */
function getInfoPageStatusElements() {
    // OD Model
    const objDetContainer = document.getElementById('obj-det-status');
    objDetStatusText = objDetContainer?.querySelector('.status-text');
    objDetProgressBar = document.getElementById('obj-det-progress');

    // Classifier Model
    const classifierContainer = document.getElementById('classifier-status');
    classifierStatusText = classifierContainer?.querySelector('.status-text');
    classifierProgressBar = document.getElementById('classifier-progress');

    // Combined Status Elements
    combinedStatusIcon = document.getElementById('combined-status-icon');
    overallStatusText = document.getElementById('overall-status-text');
}

/**
 * Updates the model status display (icon and text).
 * @param {string} modelKey - 'objectDetection' or 'classifier'
 * @param {Object} status - One of the STATUS constants (RED, ORANGE, GREEN)
 */

function navigateTo(step) {
    if (currentPage === 1 && step > 1 && !validateStep1()) {
        return;
    }
    
    if (currentPage === 2 && step !== 2) {
        stopCamera();

        // Turn off detection states
        isOdDetectionVisible = false;
        isAutoCaptureActive = false;

        // --- NEW: Reset UI elements for OD Detection ---
        const odToggle = document.getElementById('odDetectionToggle');
        const autoBtn = document.getElementById('autoCaptureToggleBtn');
        const boxCanvas = document.getElementById('boundingBoxCanvas');

        if (odToggle) {
            odToggle.checked = false; // Uncheck the toggle
        }

        if (autoBtn) {
            // Reset button to its initial "OD OFF" state
            autoBtn.disabled = true;
            autoBtn.classList.remove('ready', 'active');
            autoBtn.textContent = 'Object Detection OFF';
        }
        
        if (boxCanvas) {
            // Explicitly clear any lingering bounding box
            const ctx = boxCanvas.getContext('2d');
            ctx.clearRect(0, 0, boxCanvas.width, boxCanvas.height);
        }
    }

    // MODIFICATION: Add new page 6 to the list of pages to deactivate
    document.getElementById(`page-basic`).classList.remove('active');
    document.getElementById(`page-capture`).classList.remove('active');
    document.getElementById(`page-review`).classList.remove('active');
    document.getElementById(`page-analysis`).classList.remove('active');
    document.getElementById(`page-questionnaire`).classList.remove('active');
    document.getElementById(`page-overview`)?.classList.remove('active'); // Added page 6

    currentPage = step;
    let pageId;
    switch(currentPage) {
        case 1: pageId = 'basic'; break;
        case 2: pageId = 'capture'; break;
        case 3: pageId = 'review'; break;
        case 4: pageId = 'analysis'; break;
        case 5: pageId = 'questionnaire'; break;
        case 6: pageId = 'overview'; break; // Added page 6
        default: pageId = 'basic';
    }
    document.getElementById(`page-${pageId}`).classList.add('active');

    updateStepNav();

    if (step === 2) {
        startCamera();
        renderCarousel();
        updateCaptureStatus();
        updateEyeToggleUI();
    }
    if (step === 3) {
        renderReviewPage();
    }
    if (step === 4) {
        renderAnalysisPage();
    }
    if (step === 5) {
        renderTLXQuestions();
    }
    if (step === 6) { // Added page 6 logic
        renderOverviewPage();
    }
}

async function loadModels() {
    // 1. Initial State: Set text for individual status lines (NO ICONS)
    if (objDetStatusText) objDetStatusText.textContent = STATUS.ORANGE.text;
    if (classifierStatusText) classifierStatusText.textContent = STATUS.ORANGE.text;
    
    // Initialize combined status
    if (overallStatusText) {
        overallStatusText.textContent = 'Loading Models...';
    }
    
    // Load models in parallel to speed up startup time
    const results = await Promise.allSettled([
        // Auto Capture Object Detection Model (tf.loadGraphModel)
        (async () => {
            const model = await tf.loadGraphModel(
                objectDetectionModelUrl,
                {
                    onProgress: (fraction) => {
                        const percent = Math.floor(fraction * 100);
                        objDetStatusText.textContent = `Loading... ${percent}%`; 
                        if (objDetProgressBar) {
                            objDetProgressBar.style.width = `${percent}%`;
                        }
                    }
                }
            );
            objectDetectionModel = model;
            return { modelKey: 'objectDetection', model };
        })(),
        
        // Optic Disc Edema Classification Model (tf.loadLayersModel)
        (async () => {
            const model = await tf.loadLayersModel(
                classifierModelUrl,
                {
                    onProgress: (fraction) => {
                        const percent = Math.floor(fraction * 100);
                        classifierStatusText.textContent = `Loading... ${percent}%`; 
                        if (classifierProgressBar) {
                            classifierProgressBar.style.width = `${percent}%`;
                        }
                    }
                }
            );
            classifierModel = model;
            return { modelKey: 'classifier', model };
        })(),
        
        // Pretrained classifier (load in background, not tracked on status bar)
        tf.loadLayersModel(pretrainedClassifierModelUrl) 
    ]);

    // Track if all CORE models loaded for combined status
    let allCoreModelsLoaded = true;

    // 2. Update status based on results
    results.forEach(result => {
        const modelKey = result.value ? result.value.modelKey : null;
        let currentTextElement;

        // Identify which text element to update for the individual model
        if (modelKey === 'objectDetection') {
            currentTextElement = objDetStatusText;
        } else if (modelKey === 'classifier') {
            currentTextElement = classifierStatusText;
        }

        if (modelKey) {
             if (result.status === 'fulfilled') {
                console.log(`${modelKey} model loaded successfully.`);
                
                // Update progress bar to 100%
                if (modelKey === 'objectDetection' && objDetProgressBar) objDetProgressBar.style.width = `100%`;
                if (modelKey === 'classifier' && classifierProgressBar) classifierProgressBar.style.width = `100%`;

                // *** REPLACED updateModelStatus with direct text update ***
                if (currentTextElement) {
                    currentTextElement.textContent = STATUS.GREEN.text;
                }
            } else {
                console.error(`Error loading ${modelKey} model:`, result.reason);
                
                // *** REPLACED updateModelStatus with direct text update ***
                if (currentTextElement) {
                    currentTextElement.textContent = STATUS.RED.text;
                }
                allCoreModelsLoaded = false; // Flag error for combined status
            }
        } else if (result.status === 'fulfilled' && result.value) {
            pretrainedClassifierModel = result.value;
            console.log('Pretrained classifier model loaded.');
        } else if (result.status === 'rejected') {
            // Log other errors (like the pretrained model)
            console.error('Error in background model loading:', result.reason);
        }
    });

    // NEW: Update the SINGLE combined status icon and text
    const icon = combinedStatusIcon;
    const text = overallStatusText;
    
    if (icon && text) {
        let finalStatus = allCoreModelsLoaded ? STATUS.GREEN : STATUS.RED;
        let finalStatusText = allCoreModelsLoaded ? 'All Models Loaded Successfully' : 'Error Loading Core Models';

        // Update text
        text.textContent = finalStatusText;

        // Update icon - clear all dynamic classes first
        icon.className = 'fas'; 
        
        // Add new icon class (fa-check-circle or fa-times-circle)
        icon.classList.add(finalStatus.icon);
        // Remove old color classes and add the new one
        icon.classList.remove('orange', 'red', 'green', 'fa-spin', 'fa-circle-notch');
        icon.classList.add(finalStatus.color);
    }

    // NOTE: The detection loop (detectObjects) is NOT started here. 
    // It should be started when the user navigates to the Capture page (Step 2).
}


// --- Camera & Capture Logic (MODIFIED startCamera) ---

async function startCamera(deviceId = null) {
    const videoElement = document.getElementById('cameraFeed');
    stopCamera(); // Stop any existing stream
    
    // Use the provided deviceId or the currently tracked one
    const targetDeviceId = deviceId || currentDeviceId;
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alertUser("Camera access not supported in this browser.", true);
            return;
        }
        
        // MODIFIED: Request wider (4:3) aspect ratio (1280x960)
        const constraints = { 
            video: { 
                facingMode: 'environment', // Prefer environment camera
                width: { ideal: 1280 }, 
                height: { ideal: 960 }, // Changed from 720 to 960 for 4:3 aspect ratio
                // Request torch based on 'isTorchOn' state
                advanced: [{ torch: isTorchOn }] 
            },
            audio: false // Ensure audio is disabled
        };
        if (targetDeviceId) { constraints.video.deviceId = { exact: targetDeviceId }; } // Use exact match for deviceId
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = mediaStream;
        videoElement.play();

        const videoTrack = mediaStream.getVideoTracks()[0];
        // Update currentDeviceId based on what was actually started
        currentDeviceId = videoTrack.getSettings().deviceId || targetDeviceId;
        
        // Ensure UI and state reflect the initial torch state/capability
        const capabilities = videoTrack.getCapabilities();
        const settings = videoTrack.getSettings();

        // If torch is supported, try to enforce the 'isTorchOn' state (it should be on by default)
        if (capabilities.torch) {
            // Check if the stream actually has a torch setting before reading it
            isTorchOn = settings.torch || isTorchOn; 
            if (isTorchOn) {
                 videoTrack.applyConstraints({ advanced: [{ torch: true }] })
                    .catch(e => console.log('Could not manually enforce flashlight ON.', e));
            }
        } else {
             isTorchOn = false;
        }
        
        // Populate camera selector on initial load (only needed once)
        if (availableCameras.length === 0 || !targetDeviceId) {
            enumerateCameras();
        }

        updateTorchButtonUI();
        
    } catch (error) {
        console.error("Error accessing camera:", error);
        alertUser("Could not access camera. Please check permissions or device.", true);
    }
}

// --- Camera Options Logic (NEW) ---

async function enumerateCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) {
        console.log("enumerateDevices() not supported.");
        return;
    }

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableCameras = devices.filter(device => device.kind === 'videoinput');
        
        const selector = document.getElementById('cameraSelector');
        selector.innerHTML = '';
        
        if (availableCameras.length === 0) {
            selector.innerHTML = '<option>No cameras found</option>';
            selector.disabled = true;
            return;
        }
        
        availableCameras.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Camera ${index + 1}`;
            if (device.deviceId === currentDeviceId) {
                option.selected = true;
            }
            selector.appendChild(option);
        });
        
        selector.onchange = (event) => {
            currentDeviceId = event.target.value;
            // Restart camera with the new device
            startCamera(currentDeviceId); 
        };
    } catch (err) {
        console.error("Error enumerating devices:", err);
    }
}

function toggleTorch() {
    const videoTrack = mediaStream?.getVideoTracks()[0];
    if (!videoTrack) return;
    
    const capabilities = videoTrack.getCapabilities();
    if (!capabilities.torch) {
        alertUser("Flash/LED is not supported by the current camera.", true);
        return;
    }

    isTorchOn = !isTorchOn;
    
    videoTrack.applyConstraints({ advanced: [{ torch: isTorchOn }] })
        .catch(e => {
            console.error('Failed to set torch:', e);
            alertUser(`Failed to set torch: ${isTorchOn ? 'ON' : 'OFF'}`, true);
            // Revert state if failed
            isTorchOn = !isTorchOn;
        });
    
    updateTorchButtonUI();
}

function updateTorchButtonUI() {
    const torchBtn = document.getElementById('torchToggleBtn');
    if (torchBtn) {
        torchBtn.textContent = isTorchOn ? 'ON' : 'OFF';
        torchBtn.classList.toggle('primary-btn', isTorchOn);
        torchBtn.classList.toggle('secondary-btn', !isTorchOn);

        // Check if the current device actually supports torch
        const videoTrack = mediaStream?.getVideoTracks()[0];
        const capabilities = videoTrack?.getCapabilities();
        
        if (capabilities && capabilities.torch) {
            torchBtn.disabled = false;
        } else {
             torchBtn.textContent = 'N/A';
             torchBtn.disabled = true;
        }
    }
}

// Function to control visibility of the options panel
function toggleOptionsPanel(show) {
    const panel = document.getElementById('cameraOptionsPanel');
    if (show !== undefined) {
        panel.style.display = show ? 'block' : 'none';
    } else {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
    
    // On open, ensure camera list is up to date
    if (show) {
        enumerateCameras();
        updateTorchButtonUI(); // Ensure torch button reflects current state/capability
    }
}

function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
}

// --- Helper function to capture frame and convert to Base64 (MAJOR MODIFICATION 1) ---
function captureFrame() {
    const video = document.getElementById('cameraFeed');
    if (!video || !mediaStream) {
        alertUser("Camera feed is not active.", true);
        return null;
    }
    
    // ✅ FIX: Use video.videoWidth and video.videoHeight for the highest 
    // resolution, non-distorted frame.
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) {
        console.warn("Video dimensions are zero, stream might not be ready. Falling back to default.");
    }
    
    // Create a temporary canvas element
    const canvas = document.createElement('canvas');
    
    // Set canvas dimensions to the native video resolution (or the requested 1280x960 fallback)
    canvas.width = videoWidth || 1280;
    canvas.height = videoHeight || 960; 
    
    const context = canvas.getContext('2d');
    
    // Draw the current video frame onto the canvas without distortion
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert the canvas content to a JPEG base64 string
    const base64Data = canvas.toDataURL('image/jpeg', 0.9); // Quality set to 90%
    
    return base64Data;
}

// --- NEW HELPER FOR HIGH-RESOLUTION CAPTURE ---
function createHighResolutionCanvasFrame(videoElement) {
    // Use video.videoWidth and video.videoHeight for native resolution
    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;
    
    if (videoWidth === 0 || videoHeight === 0) {
        console.warn("Video dimensions are zero, unable to create high-res frame.");
        return null;
    }

    const highResCanvas = document.createElement('canvas');
    highResCanvas.width = videoWidth;
    highResCanvas.height = videoHeight;
    const ctx = highResCanvas.getContext('2d');
    
    // Draw the current video frame onto the canvas at native resolution
    ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
    
    return highResCanvas;
}

function drawBoundingBox(box, score) {
    const canvas = document.getElementById('boundingBoxCanvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('cameraFeed');
    if (!canvas || !ctx || !video) return;

    // Match canvas size to visible video
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear previous drawings
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Unpack normalized detection box: [ymin, xmin, ymax, xmax]
    let [ymin, xmin, ymax, xmax] = box;

    // --- TRANSFORM CORRECTIONS (for rotated video streams) ---
    // Flip both horizontally and vertically
    const flipped_ymin = 1 - ymax;
    const flipped_ymax = 1 - box[0];
    const flipped_xmin = 1 - xmax;
    const flipped_xmax = 1 - box[1];

    // Compute coordinates in display pixels
    const x = flipped_xmin * canvas.width;
    const y = flipped_ymin * canvas.height;
    const width = (flipped_xmax - flipped_xmin) * canvas.width;
    const height = (flipped_ymax - flipped_ymin) * canvas.height;

    // Draw bounding box
    ctx.save();
    // ✅ FIX 1: Change line color to white
    ctx.strokeStyle = 'white'; 
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, width, height);

    // ✅ FIX 2: Draw Label Above the Box (Black Text with White Background)
    const labelText = `Optic Disc (${(score * 100).toFixed(1)}%)`;
    ctx.font = '18px Roboto'; // Slightly larger font for better visibility
    const textMetrics = ctx.measureText(labelText);
    const textWidth = textMetrics.width;
    const textHeight = 22; // Approximate height for the background box

    // Calculate background box position (just above the bounding box)
    const labelX = x;
    // Position text box 5px above the bounding box top edge (y)
    const labelY = y - textHeight - 5; 

    // Draw background box (white)
    ctx.fillStyle = 'white';
    // Add 10px padding around the text
    ctx.fillRect(labelX, labelY, textWidth + 10, textHeight); 

    // Draw text (black)
    ctx.fillStyle = 'black';
    // Position text inside the white padding box
    ctx.fillText(labelText, labelX + 5, labelY + textHeight - 5); 
    
    ctx.restore();
}


function cropFrameByBox(sourceCanvas, box) {
    // box = [ymin, xmin, ymax, xmax] (normalized 0–1, potentially padded)
    const [ymin, xmin, ymax, xmax] = box;
    const srcWidth = sourceCanvas.width;
    const srcHeight = sourceCanvas.height;

    // Calculate pixel coordinates from normalized box and source canvas dimensions
    const x = xmin * srcWidth;
    const y = ymin * srcHeight;
    const width = (xmax - xmin) * srcWidth;
    const height = (ymax - ymin) * srcHeight;

    // Create a new canvas for the cropped area
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');

    // Copy the region from the source
    cropCtx.drawImage(
        sourceCanvas,
        x, y, width, height, // source region
        0, 0, width, height  // destination
    );

    return cropCanvas.toDataURL('image/jpeg', 0.9);
}


function manualImageCapture() {
    // Determine the new image name
    const type = 'MANUAL';
    let count;
    if (currentEye === 'LEFT') {
        manualLeftCount++;
        count = manualLeftCount;
    } else {
        manualRightCount++;
        count = manualRightCount;
    }
    const name = `${currentEye.charAt(0)}M${count}`; // e.g., LM1, RM2
    
    // For mock-up purposes, generate a mock URL with the name
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${name}`;
    const base64 = captureFrame() || mockUrl; // Use real capture or mock URL

    const newImage = { 
        id: Date.now(), 
        base64: base64, 
        eye: currentEye, 
        selected: false,
        name: name, // Store the name
        type: type // Store the type
    };
    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
}

function mockImageCapture() { 
    // Determine the new image name
    const type = 'AUTO';
    let count;
    if (currentEye === 'LEFT') {
        autoLeftCount++;
        count = autoLeftCount;
    } else {
        autoRightCount++;
        count = autoRightCount;
    }
    const name = `${currentEye.charAt(0)}A${count}`; // e.g., LA1, RA2
    
    // For mock-up purposes, generate a mock URL with the name
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${name}`;
    const base64 = captureFrame() || mockUrl; // Use real capture or mock URL
    
    const newImage = { 
        id: Date.now(), 
        base64: base64, 
        eye: currentEye, 
        selected: false,
        name: name, // Store the name
        type: type // Store the type
    };
    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
}



async function detectObjects() {
    // The loop is now controlled by the visibility toggle, not the capture button
    if (!isOdDetectionVisible || !objectDetectionModel) {
        // Keep the loop idle until the toggle is on
        if (isOdDetectionVisible) {
            detectionFrameId = window.requestAnimationFrame(detectObjects);
        }
        return;
    }

    const video = document.getElementById('cameraFeed');
    if (!video || video.readyState < 2) {
        window.requestAnimationFrame(detectObjects);
        return;
    }

    // Canvas for model input (low resolution for speed)
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    tf.engine().startScope();
    try {
        const img = tf.browser.fromPixels(canvas);
        const resized = tf.image.resizeBilinear(img, [640, 480]);
        const casted = resized.cast('int32');
        const expanded = casted.expandDims(0);
        const predictions = await objectDetectionModel.executeAsync(expanded);

        const scores = (await predictions[3].array())[0][0];
        const boxes = (await predictions[1].array())[0][0];

        // If the user turned off the toggle while the model was running,
        // abort this frame immediately before drawing anything.
        if (!isOdDetectionVisible) {
            tf.engine().endScope();
            return; // Exit the function now.
        }

        if (scores > detectionThreshold) {
            drawBoundingBox(boxes, scores); // Draws the visualization

            const currentTime = Date.now();
            // Only save an image if auto-capture is explicitly activated
            if (isAutoCaptureActive && (currentTime - lastActionTime > detectionDelay)) {
                lastActionTime = currentTime;
                console.log('Auto-capturing object with score:', scores);

                // --- START PADDING LOGIC (10% DILATION) ---
                let [ymin, xmin, ymax, xmax] = boxes;
                const paddingRatio = 0.10; // 10% total padding
                
                // Calculate padding based on the box dimensions
                const yRange = ymax - ymin;
                const xRange = xmax - xmin;
                
                // For a 10% total padding (5% on each side)
                const yPadding = (yRange * paddingRatio) / 2;
                const xPadding = (xRange * paddingRatio) / 2;
                
                // Apply padding and ensure coordinates remain within [0, 1]
                const padded_ymin = Math.max(0, ymin - yPadding);
                const padded_ymax = Math.min(1, ymax + yPadding);
                const padded_xmin = Math.max(0, xmin - xPadding);
                const padded_xmax = Math.min(1, xmax + xPadding);
                
                const paddedBox = [padded_ymin, padded_xmin, padded_ymax, padded_xmax];
                // --- END PADDING LOGIC ---

                const video = document.getElementById('cameraFeed');
                // Create a canvas with the full, native video resolution
                const highResCanvas = createHighResolutionCanvasFrame(video);
                
                if (!highResCanvas) {
                    tf.engine().endScope(); 
                    window.requestAnimationFrame(detectObjects);
                    return;
                }

                // Use the paddedBox for cropping the high-resolution image
                const croppedBase64 = cropFrameByBox(highResCanvas, paddedBox); 

                const type = 'AUTO';
                let count;
                if (currentEye === 'LEFT') {
                    autoLeftCount++;
                    count = autoLeftCount;
                } else {
                    autoRightCount++;
                    count = autoRightCount;
                }
                const name = `${currentEye.charAt(0)}A${count}`;

                const newImage = {
                    id: Date.now(),
                    base64: croppedBase64,
                    eye: currentEye,
                    selected: false,
                    name,
                    type
                };
                capturedImages.push(newImage);
                renderCarousel();
                updateCaptureStatus();
            }
        } else {
            const boxCanvas = document.getElementById('boundingBoxCanvas');
            const ctx = boxCanvas.getContext('2d');
            ctx.clearRect(0, 0, boxCanvas.width, boxCanvas.height);
        }

    } catch (e) {
        console.warn('Object detection error:', e);
    }
    tf.engine().endScope();

    // Keep the loop going as long as the toggle is on
    if (isOdDetectionVisible) {
        window.requestAnimationFrame(detectObjects);
    }
}

function toggleOdCapture() {
    const odToggle = document.getElementById('odDetectionToggle');
    // Prevent activation if the main OD toggle is off
    if (!odToggle?.checked) {
        alertUser('Turn ON OD Detection before enabling auto capture.', true);
        return;
    }

    isAutoCaptureActive = !isAutoCaptureActive; // Toggle the saving state

    const autoBtn = document.getElementById('autoCaptureToggleBtn');
    if (isAutoCaptureActive) {
        autoBtn.textContent = 'AUTO CAPTURE (ACTIVE)';
        autoBtn.classList.add('active');
    } else {
        autoBtn.textContent = 'AUTO CAPTURE (INACTIVE)';
        autoBtn.classList.remove('active');
    }
}

function updateCaptureStatus() {
    const leftCount = capturedImages.filter(img => img.eye === 'LEFT').length;
    const rightCount = capturedImages.filter(img => img.eye === 'RIGHT').length;
    
    // FIX: Changed 'imageCountOverlay' to 'imageCounter' to match the HTML ID.
    const imageCounterOverlay = document.getElementById('imageCounter');
    if (imageCounterOverlay) {
        imageCounterOverlay.textContent = `LEFT: ${leftCount} | RIGHT: ${rightCount}`;
    }
}

function toggleEyeSelection(eye) {
    currentEye = eye;
    updateEyeToggleUI();
}
function updateEyeToggleUI() {
    const leftBtn = document.getElementById('eyeToggleLeft');
    const rightBtn = document.getElementById('eyeToggleRight');
    if (!leftBtn || !rightBtn) return;
    if (currentEye === 'LEFT') {
        leftBtn.classList.add('active');
        rightBtn.classList.remove('active');
    } else {
        rightBtn.classList.add('active');
        leftBtn.classList.remove('active');
    }
}

// --- Carousel Logic (Page 2) (UNCHANGED) ---
function renderCarousel() {
    const carousel = document.getElementById('carousel');
    carousel.innerHTML = '';
    const imagesToDisplay = capturedImages; 
    imagesToDisplay.forEach((img, index) => {
        const item = document.createElement('div');
        item.className = `carousel-item carousel-item-${img.eye.toLowerCase()}`; 
        item.setAttribute('data-id', img.id);
        const image = document.createElement('img');
        image.src = img.base64;
        image.alt = `${img.eye} Image ${img.name}`; 
        
        // NEW: Image label element
        const label = document.createElement('div');
        label.className = 'image-label-thumbnail';
        label.textContent = img.name; // Display the name (e.g., LM1)
        
        item.appendChild(image);
        item.appendChild(label); // Append label
        carousel.appendChild(item);
    });
    carousel.scrollLeft = carousel.scrollWidth;
}


// --- Page 3: Review Logic (UNCHANGED) ---

function renderReviewPage() {
    const gridLeft = document.getElementById('review-grid-left');
    const gridRight = document.getElementById('review-grid-right');
    gridLeft.innerHTML = '';
    gridRight.innerHTML = '';

    const reviewControlsTop = document.querySelector('.review-controls-top');
    
    if (capturedImages.length === 0) {
        gridLeft.innerHTML = '<p style="padding: 10px;">No images captured for the left eye.</p>';
        gridRight.innerHTML = '<p style="padding: 10px;">No images captured for the right eye.</p>';
        reviewControlsTop.style.display = 'none';
        return;
    }
    
    reviewControlsTop.style.display = 'flex';

    const toggleBtn = document.getElementById('selectMultipleBtn');
    toggleBtn.textContent = isSelectionMode ? 'Exit Selection Mode' : 'Toggle Selection';
    toggleBtn.classList.toggle('active', isSelectionMode);

    const leftImages = capturedImages.filter(img => img.eye === 'LEFT');
    const rightImages = capturedImages.filter(img => img.eye === 'RIGHT');
    
    document.getElementById('left-eye-gallery-title').textContent = `LEFT EYE (${leftImages.length})`;
    document.getElementById('right-eye-gallery-title').textContent = `RIGHT EYE (${rightImages.length})`;

    const createImageElement = (img, eyeSet) => {
        const wrapper = document.createElement('div');
        wrapper.className = `review-image-wrapper ${img.selected ? 'selected' : ''}`;
        wrapper.setAttribute('data-img-id', img.id);
        wrapper.onclick = () => {
            if (isSelectionMode) {
                toggleImageSelection(img.id);
            } else {
                openLightbox(img.id, eyeSet);
            }
        };
        const image = document.createElement('img');
        image.src = img.base64;
        image.alt = `${img.eye} Image ${img.name}`;

        const label = document.createElement('div');
        label.className = 'image-label-thumbnail';
        label.textContent = img.name;

        const overlay = document.createElement('div');
        overlay.className = 'selection-overlay';
        overlay.innerHTML = '&#x2713;';
        wrapper.appendChild(image);
        wrapper.appendChild(label); // Append label
        wrapper.appendChild(overlay);
        return wrapper;
    };

    leftImages.forEach(img => gridLeft.appendChild(createImageElement(img, leftImages)));
    rightImages.forEach(img => gridRight.appendChild(createImageElement(img, rightImages)));
    
    updateDeleteButtonCount();
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    if (!isSelectionMode) {
        capturedImages.forEach(img => img.selected = false);
    }
    renderReviewPage();
}

function toggleImageSelection(imageId) {
    const image = capturedImages.find(img => img.id === imageId);
    if (image) {
        image.selected = !image.selected;
        const wrapper = document.querySelector(`[data-img-id="${imageId}"]`);
        if (wrapper) {
            wrapper.classList.toggle('selected', image.selected);
        }
        updateDeleteButtonCount();
    }
}

function updateDeleteButtonCount() {
    const selectedCount = capturedImages.filter(img => img.selected).length;
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    deleteBtn.textContent = `Delete Selected (${selectedCount})`;
    deleteBtn.disabled = selectedCount === 0;
}

function deleteSelectedImages() {
    const selectedCount = capturedImages.filter(img => img.selected).length;
    if (selectedCount === 0) return;

    if (customConfirm(`Are you sure you want to delete ${selectedCount} selected image(s)?`)) {
        capturedImages = capturedImages.filter(img => !img.selected);
        if (capturedImages.length === 0) {
             isSelectionMode = false;
        } else {
             capturedImages.forEach(img => img.selected = false);
        }
        renderReviewPage();
        updateCaptureStatus();
        alertUser(`${selectedCount} image(s) deleted.`);
    }
}

function clearAllImages() {
    if (capturedImages.length === 0) return;
    
    if (customConfirm(`Are you sure you want to delete ALL ${capturedImages.length} captured images? This cannot be undone.`)) {
        capturedImages = [];
        isSelectionMode = false;
        renderReviewPage();
        updateCaptureStatus();
        alertUser(`All images deleted.`);
    }
}


// --- Lightbox Functionality (UNCHANGED) ---

function openLightbox(imageId, imageSet) {
    lightboxImageSetet = imageSet;
    lightboxCurrentIndex = lightboxImageSetet.findIndex(img => img.id === imageId);
    
    if (lightboxCurrentIndex === -1) return;

    document.getElementById('lightbox-overlay').style.display = 'flex';
    updateLightboxImage();
}

function closeLightbox() {
    document.getElementById('lightbox-overlay').style.display = 'none';
    // When lightbox closes, re-render review page to reflect any selection changes.
    if (currentPage === 3) {
        renderReviewPage();
    }
}

function updateLightboxImage() {
    // Defensive checks: ensure we have an image set and an index
    if (!Array.isArray(lightboxImageSetet) || lightboxImageSetet.length === 0) {
        console.warn('Lightbox: no images to show.');
        // Hide image if possible and show a placeholder text
        const lightboxImgElEmpty = document.getElementById('lightbox-image');
        const infoElEmpty = document.getElementById('lightbox-info');
        if (lightboxImgElEmpty) {
            lightboxImgElEmpty.src = '';
            lightboxImgElEmpty.alt = 'No image available';
        }
        if (infoElEmpty) infoElEmpty.textContent = 'Enlarged view';
        // Disable nav buttons if present
        const prevBtnEmpty = document.getElementById('lightbox-prev');
        const nextBtnEmpty = document.getElementById('lightbox-next');
        if (prevBtnEmpty) prevBtnEmpty.disabled = true;
        if (nextBtnEmpty) nextBtnEmpty.disabled = true;
        return;
    }

    // Clamp index within bounds
    if (typeof lightboxCurrentIndex !== 'number' || lightboxCurrentIndex < 0) lightboxCurrentIndex = 0;
    if (lightboxCurrentIndex >= lightboxImageSetet.length) lightboxCurrentIndex = lightboxImageSetet.length - 1;

    const img = lightboxImageSetet[lightboxCurrentIndex];
    if (!img) {
        console.warn('Lightbox: invalid image at current index.');
        return;
    }

    // Elements
    const lightboxImgEl = document.getElementById('lightbox-image');
    const infoEl = document.getElementById('lightbox-info');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const selectBtn = document.getElementById('lightboxSelectBtn');
    const deleteBtn = document.getElementById('lightboxDeleteBtn');

    // Update main image element
    if (lightboxImgEl) {
        if (img.base64) {
            lightboxImgEl.src = img.base64;
            lightboxImgEl.alt = img.name ? `${img.eye || ''} - ${img.name}` : 'Captured Image';
        } else {
            lightboxImgEl.src = '';
            lightboxImgEl.alt = 'No image available';
        }
    }

    // Build info HTML: name on top, OD / classification score below (as requested)
    if (infoEl) {
        const nameText = img.name ? String(img.name) : '';
        // Prefer classifier probability -> img.classification.probability, then img.score, then img.odScore
        let scorePct = null;
        if (img.classification && typeof img.classification.probability === 'number' && !isNaN(img.classification.probability)) {
            scorePct = img.classification.probability;
        } else if (typeof img.score === 'number' && !isNaN(img.score)) {
            scorePct = img.score;
        } else if (typeof img.odScore === 'number' && !isNaN(img.odScore)) {
            scorePct = img.odScore;
        }

        // Also show a textual label if available (classification class / resultLabel / classification.result)
        const label = img.resultLabel || (img.classification && img.classification.class) || (img.classification && img.classification.result) || '';

        // Compose HTML — name first (top), score/label second (below)
        let html = `<div class="lightbox-name" style="font-weight:700;margin-bottom:6px;">${nameText || 'Unnamed image'}</div>`;

        if (label && scorePct !== null) {
            // e.g. "ODE 87.3%"
            const pct = (Number(scorePct) * 100).toFixed(1);
            html += `<div class="lightbox-od-score">${label} ${pct}%</div>`;
        } else if (label) {
            html += `<div class="lightbox-od-score">${label}</div>`;
        } else if (scorePct !== null) {
            const pct = (Number(scorePct) * 100).toFixed(1);
            html += `<div class="lightbox-od-score">Score: ${pct}%</div>`;
        } else {
            html += `<div class="lightbox-od-score">No score available</div>`;
        }

        infoEl.innerHTML = html;
    }

    // Update select/deselect button if present
    if (selectBtn) {
        selectBtn.textContent = img.selected ? 'Deselect' : 'Select';
        selectBtn.classList.toggle('active', !!img.selected);
    }

    // Update delete button enabled state if present
    if (deleteBtn) {
        deleteBtn.disabled = false; // allow deletion by default; caller can change if needed
    }

    // Update navigation buttons (disable at bounds)
    if (prevBtn) prevBtn.disabled = (lightboxCurrentIndex === 0);
    if (nextBtn) nextBtn.disabled = (lightboxCurrentIndex === lightboxImageSetet.length - 1);
}

function showNextImage() {
    lightboxCurrentIndex = (lightboxCurrentIndex + 1) % lightboxImageSetet.length;
    updateLightboxImage();
}

function showPrevImage() {
    lightboxCurrentIndex = (lightboxCurrentIndex - 1 + lightboxImageSetet.length) % lightboxImageSetet.length;
    updateLightboxImage();
}

// MODIFICATION 2: New function to select image from lightbox
function selectImageFromLightbox() {
    if (!isSelectionMode) {
        isSelectionMode = true; // Automatically enter selection mode
    }
    const currentImg = lightboxImageSetet[lightboxCurrentIndex];
    currentImg.selected = !currentImg.selected;
    updateLightboxImage(); // Update button text
    updateDeleteButtonCount(); // Update main page button count
}

function deleteImageFromLightbox() {
    // Get the ID of the image currently being viewed
    const currentImgId = lightboxImageSetet[lightboxCurrentIndex].id; 
    
    if (customConfirm(`Are you sure you want to delete this image?`)) {
        // Remove from the main capturedImages array
        capturedImages = capturedImages.filter(img => img.id !== currentImgId);
        
        // Update capture status
        updateCaptureStatus();
        alertUser('Image deleted.');
        
        // MODIFICATION 2: Update the lightbox image set and index
        
        // Find the full set of images for the current eye to rebuild lightboxImageSetet
        const eye = lightboxImageSetet[lightboxCurrentIndex].eye;
        const newImageSet = capturedImages.filter(img => img.eye === eye);
        
        if (newImageSet.length === 0) {
            // If the last image was deleted, close the lightbox
            closeLightbox(); 
            // Also ensure the main review page reflects the empty state immediately
            if (currentPage === 3) renderReviewPage(); 
            return;
        }

        lightboxImageSetet = newImageSet;
        
        // Adjust the index: if we were at the end, jump to the new last image (which is now index - 1). Otherwise, stay at the current index (which is now the next image).
        // Since we removed the image, the list shrinks, and the next image takes its place.
        if (lightboxCurrentIndex >= lightboxImageSetet.length) {
            lightboxCurrentIndex = 0; // If deleting the last image, wrap to the beginning (or new last)
        }
        
        updateLightboxImage(); // Show the next image in the updated set
    }
}

// --- Page 4: Analysis Logic (UPDATED to use real classification) ---

function renderAnalysisPage() {
    const gridLeft = document.getElementById('analysis-grid-left');
    const gridRight = document.getElementById('analysis-grid-right');
    const resultLeft = document.getElementById('analysis-result-left');
    const resultRight = document.getElementById('analysis-result-right');
    
    // Clear previous content
    gridLeft.innerHTML = '';
    gridRight.innerHTML = '';

    const allLeftImages = capturedImages.filter(img => img.eye === 'LEFT');
    const allRightImages = capturedImages.filter(img => img.eye === 'RIGHT');

    // FIX: Only render the top 5 images used for analysis
    const imagesToRenderLeft = findTopKValues(allLeftImages, TOP_K_IMAGES);
    const imagesToRenderRight = findTopKValues(allRightImages, TOP_K_IMAGES);

    /**
     * Creates a styled image wrapper with the classification score label.
     */
    const createAnalysisImageWrapper = (img) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'analysis-image-wrapper top-k-image';

        const imageEl = document.createElement('img');
        imageEl.src = img.base64;
        imageEl.alt = `${img.eye} Image ${img.name}`;

        // Score label (top)
        const scoreLabel = document.createElement('div');
        scoreLabel.className = 'analysis-score-label';

        // Name label (bottom)
        const nameLabel = document.createElement('div');
        nameLabel.className = 'analysis-name-label';
        nameLabel.textContent = img.name || '';

        const classification = img.classification;
        if (classification && classification.class && classification.class !== 'error') {
            // Use stored probability (should now exist after the runAnalysis fix)
            const pct = (typeof classification.probability === 'number')
                ? `${(classification.probability * 100).toFixed(0)}%`
                : '?%';
            scoreLabel.textContent = `${classification.class} ${pct}`;
            scoreLabel.classList.add(`score-${classification.class.toLowerCase().replace('_', '-')}`);
        } else {
            // Fall back to odScore (if present) or show placeholder
            const displayScore = (typeof img.odScore === 'number' && img.odScore > 0)
                ? `OD: ${(img.odScore * 100).toFixed(1)}%`
                : '—';
            scoreLabel.textContent = displayScore;
            scoreLabel.classList.add('score-unanalyzed');
        }

        wrapper.appendChild(imageEl);
        wrapper.appendChild(scoreLabel); // top
        wrapper.appendChild(nameLabel);  // bottom
        return wrapper;
    };
    
    // Render ONLY the calculated top 5 images
    imagesToRenderLeft.forEach(img => gridLeft.appendChild(createAnalysisImageWrapper(img)));
    imagesToRenderRight.forEach(img => gridRight.appendChild(createAnalysisImageWrapper(img)));
    
    // Update the main result summaries and apply visual styling
    const updateResultDisplay = (el, resultText, resultClass) => {
        el.textContent = resultText;
        el.classList.remove('result-success', 'result-warning');
        
        // Error fix: Only apply class if a valid class string is present
        if (resultClass) {
            el.classList.add(resultClass);
        }
    };
    
    // Use the class stored in analysisResults to apply the correct theme
    updateResultDisplay(resultLeft, analysisResults.left, analysisResults.leftClass);
    updateResultDisplay(resultRight, analysisResults.right, analysisResults.rightClass);
}

/**
 * Selects the top K elements (images) with the highest OD score (stored in the 'odScore' property).
 * @param {Array<Object>} elements - Array of captured image objects.
 * @param {number} k - The number of top elements to return.
 * @returns {Array<Object>} - The top K elements.
 */
/**
 * Selects the top K elements (images) with the highest OD score (stored in the 'odScore' property).
 */
function findTopKValues(elements, k) {
    if (elements.length === 0) return [];

    // Sort by odScore in descending order (highest score first)
    const sorted = [...elements].sort((a, b) => (b.odScore || 0) - (a.odScore || 0));

    // Return the top K elements
    return sorted.slice(0, k);
}


async function runAnalysis() {
    const analysisBtn = document.getElementById('runAnalysisBtn');
    analysisBtn.disabled = true;
    analysisBtn.textContent = 'Analyzing Top 5...';

    if (!classifierModel || !pretrainedClassifierModel) {
        alertUser("Classification models are still loading or failed to load. Please wait.", true);
        analysisBtn.disabled = false;
        analysisBtn.textContent = 'Run Analysis';
        return;
    }

    const allLeftImages = capturedImages.filter(img => img.eye === 'LEFT');
    const allRightImages = capturedImages.filter(img => img.eye === 'RIGHT');

    const imagesToClassifyLeft = findTopKValues(allLeftImages, TOP_K_IMAGES);
    const imagesToClassifyRight = findTopKValues(allRightImages, TOP_K_IMAGES);

    /**
     * Runs classification for the top K images of one eye and determines a majority class.
     */
    const analyzeEye = async (images, eyeName = 'Unknown') => {
        if (images.length === 0)
            return { text: 'NO IMAGES CAPTURED.', class: 'result-warning' };

        console.log(`▶ Analyzing ${images.length} ${eyeName} images...`);
        const predictions = [];

        for (const img of images) {
            const imageElement = await getImageDataFromBase64(img.base64);
            if (!imageElement) {
                console.warn('Skipping image: could not decode base64');
                continue;
            }

            // --- Run model prediction ---
            const prediction = await predict(imageElement, classifierModel);
            if (!prediction || !prediction.class) {
                console.warn('Prediction failed or empty for one image.');
                continue;
            }

            predictions.push(prediction);

            // Store per-image classification results
            img.classification = {
                result: `${prediction.class} (${(prediction.probability * 100).toFixed(0)}%)`,
                class: prediction.class,
                probability: prediction.probability,
                rawScore: prediction.rawScore ?? prediction.probability,
                isTopK: true
            };
            img.score = prediction.probability;
            img.resultLabel = prediction.class;
        } // <-- this brace was missing before!

        // --- STEP 2: Determine Final Result and Text ---
        const majorityClass = getMajorityClass(predictions);
        let resultText = '';
        let resultClass = 'result-warning'; // Default amber
        const totalVotes = predictions.filter(p => p.class !== 'error').length;
        const odeVotes = predictions.filter(p => p.class === 'ODE').length;

        if (majorityClass.class === 'N/A') {
            resultText = 'Analysis failed: No valid images found.';
        } else if (majorityClass.class === 'not_ODE') {
            const notOdeVotes = totalVotes - odeVotes;
            resultText = `No Optic Disc Edema detected. Vote ratio: ${notOdeVotes}/${totalVotes}`;
            resultClass = 'result-success';
        } else if (majorityClass.class === 'ODE') {
            resultText = `Optic Disc Edema suspected. Further review recommended. Vote ratio: ${odeVotes}/${totalVotes}`;
        } else if (majorityClass.class === 'INCONCLUSIVE') {
            resultText = `Non-conclusive result. Please repeat image capture. Vote ratio: ${odeVotes}/${totalVotes}`;
        }

        console.log(`✔ ${eyeName} analysis complete → ${majorityClass.class} (${odeVotes}/${totalVotes})`);
        return { text: resultText, class: resultClass };
    };

    alertUser("Starting classification of top 5 images...");

    // Run analysis for both eyes in parallel
    const [leftResult, rightResult] = await Promise.all([
        analyzeEye(imagesToClassifyLeft, 'LEFT'),
        analyzeEye(imagesToClassifyRight, 'RIGHT')
    ]);

    // Store and display results
    analysisResults.left = leftResult.text;
    analysisResults.right = rightResult.text;
    analysisResults.leftClass = leftResult.class;
    analysisResults.rightClass = rightResult.class;

    renderAnalysisPage();

    analysisBtn.disabled = false;
    analysisBtn.textContent = 'Run Analysis';
    alertUser("Analysis complete.");
}


// NEW HELPER: Get the image data required by TF from the Base64 string
// Returns a Promise that resolves to an HTMLCanvasElement suitable for tf.browser.fromPixels
function getImageDataFromBase64(base64) {
    const img = new Image();
    img.src = base64;
    
    return new Promise((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Use the full resolution of the captured image
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            resolve(canvas);
        };
        img.onerror = () => resolve(null); // Resolve to null on error
    });
}

// preprocess the image for the classification, classify the image and uses the threshold set to obtain the result
// (Based on original logic for single sigmoid output)
async function predict(imageElement, model) {
    if (!imageElement) return { class: 'not_ODE', probability: 0, rawScore: 0 };
    
    tf.engine().startScope();
    try {
        const tensor = tf.browser.fromPixels(imageElement);
        const normalizedTensor = tensor.div(tf.scalar(255));
        // Resize to 224x224 (MobileNet/Classifier standard input size)
        const resized = tf.image.resizeBilinear(normalizedTensor, [224, 224]);
        const expanded = resized.expandDims(0);
        
        const prediction = await model.predict(expanded).data();
        
        tf.dispose([tensor, normalizedTensor, resized, expanded]);
        
        // Assuming single sigmoid output where value > threshold is 'not_ODE'
        const nonODEProbability = parseFloat(prediction[0]);
        
        if (nonODEProbability > CLASSIFICATION_THRESHOLD) {
            return { class: 'not_ODE', probability: nonODEProbability, rawScore: nonODEProbability };
        } else {
            // The probability is inverted for the 'ODE' class
            return { class: 'ODE', probability: 1 - nonODEProbability, rawScore: nonODEProbability };
        }
    } catch (e) {
        console.error("Prediction error:", e);
        tf.engine().endScope();
        return { class: 'error', probability: 0, rawScore: 0 };
    } finally {
        tf.engine().endScope();
    }
}

// Takes the majority class based on vote count.
function getMajorityClass(predictions) {
    const counts = { 'ODE': 0, 'not_ODE': 0 };
    
    // Filter out images that failed to load or classify
    const validPredictions = predictions.filter(p => p.class !== 'error');
    if (validPredictions.length === 0) return { class: 'N/A', probability: 0, count: 0 };

    for (const prediction of validPredictions) {
        counts[prediction.class] += 1;
    }
    
    const ODECount = counts['ODE'];
    const notODECount = counts['not_ODE'];
    const total = ODECount + notODECount;

    // Determine majority class and probability (ratio of votes)
    if (ODECount === notODECount) {
        return { class: 'INCONCLUSIVE', probability: 0.5, count: total };
    } else if (ODECount > notODECount) {
        return { class: 'ODE', probability: ODECount / total, count: total };
    } else {
        return { class: 'not_ODE', probability: notODECount / total, count: total };
    }
}



// --- Page 5: Questionnaire Logic (MODIFIED to capture answers) ---

function renderTLXQuestions() {
    const container = document.querySelector('#page-questionnaire .nasa-tlx-questions');
    container.innerHTML = '';
    TLX_DIMENSIONS.forEach((dim, index) => {
        const row = document.createElement('div');
        row.className = 'question-row';
        const tlxKey = `q${index + 1}_${dim.name.replace(/\s/g, '')}`;
        const storedValue = tlxAnswers[tlxKey] !== undefined ? tlxAnswers[tlxKey] : 10;
        
        row.innerHTML = `
            <p>${dim.prompt}</p>
            <div class="slider-wrapper">
                <span class="slider-label">LOW</span>
                <input type="range" min="0" max="20" value="${storedValue}" id="tlx_q${index + 1}">
                <span class="slider-label">HIGH</span>
            </div>
        `;
        container.appendChild(row);
    });
    document.getElementById('comments').value = subjectInfo.notes || '';
}

function captureTLXAnswers() {
    tlxAnswers = {};
    TLX_DIMENSIONS.forEach((dim, index) => {
        const inputId = `tlx_q${index + 1}`;
        const input = document.getElementById(inputId);
        tlxAnswers[`q${index + 1}_${dim.name.replace(/\s/g, '')}`] = parseInt(input ? input.value : 0);
    });
    subjectInfo.notes = document.getElementById('comments').value.trim();
}


// --- Page 6: Overview Logic (NEW) ---

function renderOverviewPage() {
    // 1. Session Details
    document.getElementById('overviewOperatorId').textContent = subjectInfo.operatorId || 'N/A';
    document.getElementById('overviewSubjectId').textContent = subjectInfo.id || 'N/A';

    // 2. Image Review Carousels
    const leftImages = capturedImages.filter(img => img.eye === 'LEFT');
    const rightImages = capturedImages.filter(img => img.eye === 'RIGHT');
    
    document.getElementById('overviewLeftCount').textContent = leftImages.length;
    document.getElementById('overviewRightCount').textContent = rightImages.length;

    const renderOverviewCarousel = (containerId, images) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        if (images.length === 0) {
            container.innerHTML = '<p style="margin: auto; font-size: 0.9em; color: #666;">No images captured.</p>';
            container.style.justifyContent = 'center';
        } else {
            images.forEach(img => {
                // MODIFICATION: Wrap the image to position the label
                const wrapper = document.createElement('div');
                wrapper.className = 'analysis-image-wrapper'; // Use existing style for wrapper size/label positioning

                const imageEl = document.createElement('img');
                imageEl.src = img.base64;
                
                // NEW: Image label element
                const label = document.createElement('div');
                label.className = 'image-label-thumbnail';
                label.textContent = img.name;

                wrapper.appendChild(imageEl);
                wrapper.appendChild(label);
                container.appendChild(wrapper);
                // END MODIFICATION
            });
            container.style.justifyContent = 'flex-start';
        }
    };

    renderOverviewCarousel('overview-carousel-left', leftImages);
    renderOverviewCarousel('overview-carousel-right', rightImages);

    // 3. Analysis Results (MODIFIED for thematic styling)
    const resultLeftEl = document.getElementById('overview-analysis-left');
    const resultRightEl = document.getElementById('overview-analysis-right');

    resultLeftEl.textContent = analysisResults.left;
    resultRightEl.textContent = analysisResults.right;
    
    // NEW LOGIC: Apply thematic classes for consistent styling
    resultLeftEl.classList.remove('result-success', 'result-warning');
    if (analysisResults.leftClass) {
        resultLeftEl.classList.add(analysisResults.leftClass);
    }
    
    resultRightEl.classList.remove('result-success', 'result-warning');
    if (analysisResults.rightClass) {
        resultRightEl.classList.add(analysisResults.rightClass);
    }

    // 4. TLX Review and Comments
    const tlxContainer = document.getElementById('overview-tlx-results');
    tlxContainer.innerHTML = '';
    
    // Note: Assuming 'tlxAnswers' is a globally defined object
    if (Object.keys(tlxAnswers).length === 0) {
            // Should not happen if navigation is correct, but re-capture if necessary
            // captureTLXAnswers(); // Uncomment if you want to force capture here
             tlxContainer.innerHTML = '<p style="margin: auto; font-size: 0.9em; color: #666;">NASA TLX answers not found.</p>';
    } else {
        // Note: Assuming 'TLX_DIMENSIONS' is a globally defined array
        TLX_DIMENSIONS.forEach((dim, index) => {
            const key = `q${index + 1}_${dim.name.replace(/\s/g, '')}`;
            // Checkmark if the answer is present in tlxAnswers
            const isAnswered = tlxAnswers.hasOwnProperty(key); 
            
            const item = document.createElement('div');
            item.className = 'overview-tlx-item';
            item.innerHTML = `
                <span class="tlx-question-text">${dim.prompt}</span>
                <span class="tlx-status-check">${isAnswered ? '&#x2713;' : ''}</span>
            `;
            tlxContainer.appendChild(item);
        });
    }


    document.getElementById('overviewComments').textContent = subjectInfo.notes || 'No comments provided.';
}

// --- Submission (MODIFIED to be triggered from Overview) ---

async function submitSession() {
    if (window.isAuthReady !== true) {
        alertUser('Application is still initializing. Please wait.', true);
        return;
    }

    // Use the globally stored tlxAnswers (captured before navigating to Overview)
    const questionnaireData = { ...tlxAnswers };
    questionnaireData.comments = subjectInfo.notes;

    const sessionData = {
        operatorId: subjectInfo.operatorId, // ADDED
        subjectId: subjectInfo.id,
        userId: window.userId,
        timestamp: serverTimestamp(),
        analysisResults: analysisResults, // Added analysis results
        questionnaire: questionnaireData,
        imageCount: capturedImages.length,
        imageMetadata: capturedImages.map((img, index) => ({ id: img.id, index: index + 1, eye: img.eye }))
    };

    try {
        const collectionPath = `artifacts/${window.appId}/users/${window.userId}/session_data`;
        await addDoc(collection(window.db, collectionPath), sessionData);
        showModal();
    } catch (e) {
        console.error("Error adding document: ", e);
        alertUser("Submission failed. Check console.", true);
    }
}


// --- Modal Control and Session Reset (MODIFIED for new state) ---

function showModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function startNewSession() {
    capturedImages = [];
    subjectInfo = { operatorId: '', id: '', notes: '' }; // MODIFIED
    isSelectionMode = false;
    isOdDetectionOn = false;
    currentEye = 'RIGHT';

    // RESET NEW COUNTERS
    manualLeftCount = 0;
    manualRightCount = 0;
    autoLeftCount = 0;
    autoRightCount = 0;

    // MODIFICATION: Reset new state variables
    analysisResults = { left: 'Not yet run.', right: 'Not yet run.' };
    tlxAnswers = {}; 

    document.getElementById('operatorId').value = ''; // ADDED
    document.getElementById('subjectId').value = '';
    document.getElementById('comments').value = '';
    
    updateCaptureStatus();
    document.getElementById('odStatus').textContent = 'INACTIVE';
    document.getElementById('autoCaptureToggleBtn').textContent = 'AUTO CAPTURE (INACTIVE)';
    document.getElementById('autoCaptureToggleBtn').classList.remove('active');
    updateEyeToggleUI();
    renderCarousel();
    
    document.getElementById('modal-overlay').style.display = 'none';
    navigateTo(1);
}


// --- Event Listener Setup (MODIFIED for new navigation flow) ---

function setupEventListeners() {
    // Navigation (Step 1)
    document.getElementById('toCaptureBtn')?.addEventListener('click', () => navigateTo(2));

    // Capture Page (Step 2)
    document.getElementById('autoCaptureToggleBtn')?.addEventListener('click', toggleOdCapture); 
    document.getElementById('eyeToggleLeft')?.addEventListener('click', () => toggleEyeSelection('LEFT')); 
    document.getElementById('eyeToggleRight')?.addEventListener('click', () => toggleEyeSelection('RIGHT'));
    document.getElementById('manualCaptureBtn')?.addEventListener('click', manualImageCapture); 
    document.getElementById('backFromCaptureBtn')?.addEventListener('click', () => navigateTo(1)); 
    document.getElementById('toReviewBtnBottom')?.addEventListener('click', () => navigateTo(3));

    // --- OD Detection Toggle (NEW) ---
    const odToggle = document.getElementById('odDetectionToggle');
    const autoBtn = document.getElementById('autoCaptureToggleBtn');

    if (odToggle && autoBtn) {
        // Set initial button state on page load
        autoBtn.disabled = true;
        autoBtn.textContent = 'Object detection OFF';
        autoBtn.classList.remove('ready', 'active');

        odToggle.addEventListener('change', () => {
            isOdDetectionVisible = odToggle.checked;
            const boxCanvas = document.getElementById('boundingBoxCanvas');
            const ctx = boxCanvas?.getContext('2d');

            if (isOdDetectionVisible) {
                console.log("Optic Disc detection overlay enabled.");
                window.requestAnimationFrame(detectObjects);

                // State 2: OD ON, Auto-Capture OFF (Dark Green)
                autoBtn.disabled = false;
                autoBtn.classList.add('ready');
                autoBtn.classList.remove('active');
                autoBtn.textContent = 'AUTO CAPTURE (INACTIVE)';
            } else {
                console.log("Optic Disc detection overlay disabled.");
                isAutoCaptureActive = false;

                // --- FIX: Cancel the animation frame to prevent a stuck overlay ---
                if (detectionFrameId) {
                    cancelAnimationFrame(detectionFrameId);
                }

                // Clear the bounding box overlay (Handles requirement #4)
                if (ctx) {
                    ctx.clearRect(0, 0, boxCanvas.width, boxCanvas.height);
                }

                // State 1: OD OFF (Dark Grey)
                autoBtn.disabled = true;
                autoBtn.classList.remove('ready', 'active');
                autoBtn.textContent = 'Object Detection OFF';
            }
        });
    }

    // Camera Options (NEW, Step 2)
    document.getElementById('optionsBtn')?.addEventListener('click', () => toggleOptionsPanel(true));
    document.getElementById('closeOptionsBtn')?.addEventListener('click', () => toggleOptionsPanel(false));
    document.getElementById('torchToggleBtn')?.addEventListener('click', toggleTorch);

    // Review Page (Step 3) 
    document.getElementById('selectMultipleBtn')?.addEventListener('click', toggleSelectionMode);
    document.getElementById('deleteSelectedBtn')?.addEventListener('click', deleteSelectedImages);
    document.getElementById('backFromReviewBtn')?.addEventListener('click', () => navigateTo(2));
    document.getElementById('clearAllImagesBtn')?.addEventListener('click', clearAllImages);
    document.getElementById('toAnalyzeBtn')?.addEventListener('click', () => navigateTo(4));

    // Analysis Page (Step 4)
    document.getElementById('runAnalysisBtn')?.addEventListener('click', runAnalysis);
    document.getElementById('backToReviewBtn')?.addEventListener('click', () => {
        navigateTo(3); // Navigate to Review (Page 3)
    });
   document.getElementById('toTlxBtn')?.addEventListener('click', () => {
        navigateTo(5); // Navigate to TLX (Page 5)
    });

    // Questionnaire Page (Step 5)
    document.getElementById('backFromQuestionnaireBtn')?.addEventListener('click', () => navigateTo(4));
    // MODIFICATION: Change to TO OVERVIEW
    document.getElementById('toOverviewBtn')?.addEventListener('click', () => { 
        captureTLXAnswers(); // Capture answers before moving to review
        navigateTo(6);
    });

    // Overview Page (Step 6) - NEW
    document.getElementById('backFromOverviewBtn')?.addEventListener('click', () => navigateTo(5)); 
    document.getElementById('submitSessionBtn')?.addEventListener('click', submitSession); 

    // Modal & Lightbox
    document.getElementById('continueSessionBtn')?.addEventListener('click', closeModal);
    document.getElementById('newSessionBtn')?.addEventListener('click', startNewSession);
    document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
    document.getElementById('lightbox-next')?.addEventListener('click', showNextImage);
    document.getElementById('lightbox-prev')?.addEventListener('click', showPrevImage);
    document.getElementById('lightboxSelectBtn')?.addEventListener('click', selectImageFromLightbox);
    document.getElementById('lightboxDeleteBtn')?.addEventListener('click', deleteImageFromLightbox);

    // NEW: Swipe functionality for lightbox
    const lightboxOverlay = document.getElementById('lightbox-overlay');
    let touchStartX = 0;

    lightboxOverlay?.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
    });

    lightboxOverlay?.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const swipeDistance = touchEndX - touchStartX;
        const swipeThreshold = 50; // Minimum distance for a swipe

        if (Math.abs(swipeDistance) > swipeThreshold) {
            if (swipeDistance > 0) {
                showPrevImage(); // Swiping right goes to previous image
            } else {
                showNextImage(); // Swiping left goes to next image
            }
        }
    });
}


// --- Initialization ---
window.addEventListener('load', () => {
// 1. Get the new status DOM elements
    getInfoPageStatusElements();
    
    // 2. Start model loading immediately
    loadModels();
    
    // 3. Keep existing setup logic
    setupEventListeners(); 
    updateStepNav();
});
