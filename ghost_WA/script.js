let mediaStream = null; // To hold the camera stream

// --- Application State ---
let currentPage = 1;
let currentEye = 'RIGHT'; // Default to RIGHT (OD)
let capturedImages = []; 
// MODIFICATION: Add operatorId to subjectInfo
let subjectInfo = { operatorId: '', id: '', notes: '' };
let isSelectionMode = false;
let isOdDetectionOn = false; 
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
let classifierStatusIcon;
let classifierStatusText;

// NEW: Model Status Constants
const STATUS = {
    RED: { icon: 'fa-times-circle', color: 'red', text: 'ERROR' },
    ORANGE: { icon: 'fa-circle-notch fa-spin', color: 'orange', text: 'Loading...' },
    GREEN: { icon: 'fa-check-circle', color: 'green', text: 'Loaded' }
};

// --- NEW: Object Detection Loop (replaces fake auto capture) ---
let lastActionTime = 0;
const detectionDelay = 200; // Minimum ms between saved frames
const detectionThreshold = 0.7; // Customize if needed
let detectionActive = false;

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
let lightboxImageSet = [];
let lightboxCurrentIndex = 0;

// MODIFICATION: New state to store analysis and TLX results
let analysisResults = { left: 'Not yet run.', right: 'Not yet run.' };
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
    const objDetContainer = document.getElementById('obj-det-status');
    const classifierContainer = document.getElementById('classifier-status');
    
    if (objDetContainer) {
        // Find the icon and text span within the container
        objDetStatusIcon = objDetContainer.querySelector('.status-circle');
        objDetStatusText = objDetContainer.querySelector('.status-text');
    }
    if (classifierContainer) {
        classifierStatusIcon = classifierContainer.querySelector('.status-circle');
        classifierStatusText = classifierContainer.querySelector('.status-text');
    }
}

/**
 * Updates the model status display (icon and text).
 * @param {string} modelKey - 'objectDetection' or 'classifier'
 * @param {Object} status - One of the STATUS constants (RED, ORANGE, GREEN)
 */
function updateModelStatus(modelKey, status) {
    let icon, text;

    if (modelKey === 'objectDetection') {
        icon = objDetStatusIcon;
        text = objDetStatusText;
    } else if (modelKey === 'classifier') {
        icon = classifierStatusIcon;
        text = classifierStatusText;
    }

    if (icon && text) {
        // Clear existing classes (like fa-spin) and set new ones
        icon.className = 'status-circle fas';
        if (status.icon.includes('fa-spin')) {
            icon.classList.add('fa-circle-notch', 'fa-spin');
        } else {
            icon.classList.add(status.icon);
        }
        
        // Remove old color classes and add the new one
        icon.classList.remove('red', 'orange', 'green');
        icon.classList.add(status.color);
        
        // Update text
        text.textContent = status.text;
    }
}

function navigateTo(step) {
    if (currentPage === 1 && step > 1 && !validateStep1()) {
        return;
    }
    
    if (currentPage === 2 && step !== 2) {
        stopCamera();
        stopAutoCapture(); 
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
    // 1. Initial State: Set both to ORANGE (Loading)
    updateModelStatus('objectDetection', STATUS.ORANGE);
    updateModelStatus('classifier', STATUS.ORANGE);
    
    // Load models in parallel to speed up startup time
    const results = await Promise.allSettled([
        // Auto Capture Object Detection Model (tf.loadGraphModel)
        (async () => {
            const model = await tf.loadGraphModel(objectDetectionModelUrl);
            objectDetectionModel = model;
            return { modelKey: 'objectDetection', model };
        })(),
        
        // Optic Disc Edema Classification Model (tf.loadLayersModel)
        (async () => {
            const model = await tf.loadLayersModel(classifierModelUrl);
            classifierModel = model;
            return { modelKey: 'classifier', model };
        })(),
        
        // Pretrained classifier (load in background, not tracked on status bar)
        tf.loadLayersModel(pretrainedClassifierModelUrl) 
    ]);

    // 2. Update status based on results
    results.forEach(result => {
        const modelKey = result.value ? result.value.modelKey : null;

        if (modelKey) {
             if (result.status === 'fulfilled') {
                console.log(`${modelKey} model loaded successfully.`);
                updateModelStatus(modelKey, STATUS.GREEN);
            } else {
                console.error(`Error loading ${modelKey} model:`, result.reason);
                updateModelStatus(modelKey, STATUS.RED);
            }
        } else if (result.status === 'fulfilled' && result.value) {
            pretrainedClassifierModel = result.value;
            console.log('Pretrained classifier model loaded.');
        } else if (result.status === 'rejected') {
            // Log other errors (like the pretrained model)
            console.error('Error in background model loading:', result.reason);
        }
    });

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
    
    // Create a temporary canvas element
    const canvas = document.createElement('canvas');
    
    // Determine the target resolution for the captured image (e.g., matching the video track settings)
    const videoTrack = mediaStream.getVideoTracks()[0];
    const { width, height } = videoTrack.getSettings();

    // Use a fallback resolution if settings are unavailable
    canvas.width = width || 1280;
    canvas.height = height || 720;
    
    const context = canvas.getContext('2d');
    
    // Draw the current video frame onto the canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert the canvas content to a JPEG base64 string
    const base64Data = canvas.toDataURL('image/jpeg', 0.9); // Quality set to 90%
    
    return base64Data;
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

function startAutoCapture() {
    if (objectDetectionModel) {
        console.log('Starting object detection auto capture...');
        isOdDetectionOn = true;
        window.requestAnimationFrame(detectObjects);
    } else {
        alertUser('Object Detection model not loaded yet.', true);
    }
}
function stopAutoCapture() {
    if (autoCaptureInterval) {
        clearInterval(autoCaptureInterval);
        autoCaptureInterval = null;
    }
}

async function detectObjects() {
    if (!isOdDetectionOn || !objectDetectionModel) {
        window.requestAnimationFrame(detectObjects);
        return;
    }

    const video = document.getElementById('cameraFeed');
    if (!video || video.readyState < 2) {
        window.requestAnimationFrame(detectObjects);
        return;
    }

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

        // Model-dependent outputs (adjust indices if your model differs)
        const scores = (await predictions[3].array())[0][0];
        const boxes = (await predictions[1].array())[0][0];

        if (scores > detectionThreshold) {
            const currentTime = Date.now();
            if (currentTime - lastActionTime > detectionDelay) {
                lastActionTime = currentTime;
                console.log('Object detected with score:', scores);

                // Capture frame and save it
                const base64 = canvas.toDataURL('image/jpeg', 0.9);
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
                    base64,
                    eye: currentEye,
                    selected: false,
                    name,
                    type
                };
                capturedImages.push(newImage);
                renderCarousel();
                updateCaptureStatus();
            }
        }
    } catch (e) {
        console.warn('Object detection error:', e);
    }
    tf.engine().endScope();

    if (isOdDetectionOn) {
        window.requestAnimationFrame(detectObjects);
    }
}

function toggleOdCapture() {
    const odToggleBtn = document.getElementById('autoCaptureToggleBtn');
    // REMOVED: Status span update
    
    isOdDetectionOn = !isOdDetectionOn;
    if (isOdDetectionOn) {
        odToggleBtn.textContent = 'AUTO CAPTURE (ACTIVE)';
        odToggleBtn.classList.add('active');
        // REMOVED: odStatusSpan update
        startAutoCapture();
    } else {
        odToggleBtn.textContent = 'AUTO CAPTURE (INACTIVE)';
        odToggleBtn.classList.remove('active');
        // REMOVED: odStatusSpan update
        stopAutoCapture();
    }
}
function updateCaptureStatus() {
    const leftCount = capturedImages.filter(img => img.eye === 'LEFT').length;
    const rightCount = capturedImages.filter(img => img.eye === 'RIGHT').length;
    
    // MODIFICATION 1: Update the overlay element with full words
    const imageCounterOverlay = document.getElementById('imageCountOverlay');
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
    lightboxImageSet = imageSet;
    lightboxCurrentIndex = lightboxImageSet.findIndex(img => img.id === imageId);
    
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
    const img = lightboxImageSet[lightboxCurrentIndex];
    document.getElementById('lightbox-image').src = img.base64;
    
    // MODIFIED: Update info display to include image name
    document.getElementById('lightbox-info').textContent = `EYE: ${img.eye} (${img.name})`;
    
    // Update select button appearance
    const selectBtn = document.getElementById('lightboxSelectBtn');
    selectBtn.textContent = img.selected ? 'Deselect' : 'Select';
    selectBtn.classList.toggle('active', img.selected);
}

function showNextImage() {
    lightboxCurrentIndex = (lightboxCurrentIndex + 1) % lightboxImageSet.length;
    updateLightboxImage();
}

function showPrevImage() {
    lightboxCurrentIndex = (lightboxCurrentIndex - 1 + lightboxImageSet.length) % lightboxImageSet.length;
    updateLightboxImage();
}

// MODIFICATION 2: New function to select image from lightbox
function selectImageFromLightbox() {
    if (!isSelectionMode) {
        isSelectionMode = true; // Automatically enter selection mode
    }
    const currentImg = lightboxImageSet[lightboxCurrentIndex];
    currentImg.selected = !currentImg.selected;
    updateLightboxImage(); // Update button text
    updateDeleteButtonCount(); // Update main page button count
}

function deleteImageFromLightbox() {
    // Get the ID of the image currently being viewed
    const currentImgId = lightboxImageSet[lightboxCurrentIndex].id; 
    
    if (customConfirm(`Are you sure you want to delete this image?`)) {
        // Remove from the main capturedImages array
        capturedImages = capturedImages.filter(img => img.id !== currentImgId);
        
        // Update capture status
        updateCaptureStatus();
        alertUser('Image deleted.');
        
        // MODIFICATION 2: Update the lightbox image set and index
        
        // Find the full set of images for the current eye to rebuild lightboxImageSet
        const eye = lightboxImageSet[lightboxCurrentIndex].eye;
        const newImageSet = capturedImages.filter(img => img.eye === eye);
        
        if (newImageSet.length === 0) {
            // If the last image was deleted, close the lightbox
            closeLightbox(); 
            // Also ensure the main review page reflects the empty state immediately
            if (currentPage === 3) renderReviewPage(); 
            return;
        }

        lightboxImageSet = newImageSet;
        
        // Adjust the index: if we were at the end, jump to the new last image (which is now index - 1). Otherwise, stay at the current index (which is now the next image).
        // Since we removed the image, the list shrinks, and the next image takes its place.
        if (lightboxCurrentIndex >= lightboxImageSet.length) {
            lightboxCurrentIndex = 0; // If deleting the last image, wrap to the beginning (or new last)
        }
        
        updateLightboxImage(); // Show the next image in the updated set
    }
}


// --- Page 4: Analysis Logic (MODIFIED to store results) ---

function renderAnalysisPage() {
    const leftImages = capturedImages.filter(img => img.eye === 'LEFT');
    const rightImages = capturedImages.filter(img => img.eye === 'RIGHT');

    const getRandomSubset = (arr, count) => {
        const shuffled = [...arr].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    const leftSubset = getRandomSubset(leftImages, 5);
    const rightSubset = getRandomSubset(rightImages, 5);

    const gridLeft = document.getElementById('analysis-grid-left');
    const gridRight = document.getElementById('analysis-grid-right');
    gridLeft.innerHTML = '';
    gridRight.innerHTML = '';

    leftSubset.forEach(img => {
        const imageEl = document.createElement('img');
        imageEl.src = img.base64;
        gridLeft.appendChild(imageEl);
    });
    
    rightSubset.forEach(img => {
        const imageEl = document.createElement('img');
        imageEl.src = img.base64;
        gridRight.appendChild(imageEl);
    });

    const appendImageWithLabel = (grid, img) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'analysis-image-wrapper'; // Need a wrapper for label positioning
        
        const imageEl = document.createElement('img');
        imageEl.src = img.base64;
        imageEl.alt = `${img.eye} Image ${img.name}`;
        
        // NEW: Image label element
        const label = document.createElement('div');
        label.className = 'image-label-thumbnail';
        label.textContent = img.name;
        
        wrapper.appendChild(imageEl);
        wrapper.appendChild(label);
        grid.appendChild(wrapper);
    };

    gridLeft.innerHTML = '';
    gridRight.innerHTML = '';

    leftSubset.forEach(img => appendImageWithLabel(gridLeft, img));
    rightSubset.forEach(img => appendImageWithLabel(gridRight, img));
    
    // Show current stored results (if run previously), otherwise hide
    document.getElementById('analysis-result-left').textContent = analysisResults.left;
    document.getElementById('analysis-result-right').textContent = analysisResults.right;
    
    document.getElementById('analysis-result-left').style.display = (analysisResults.left !== 'Not yet run.' ? 'block' : 'none');
    document.getElementById('analysis-result-right').style.display = (analysisResults.right !== 'Not yet run.' ? 'block' : 'none');
}

function runAnalysis() {
    const resultLeft = document.getElementById('analysis-result-left');
    const resultRight = document.getElementById('analysis-result-right');
    
    // MODIFICATION: Store and display mock results
    analysisResults.left = 'LEFT EYE RESULT: NO ODE DETECTED.';
    analysisResults.right = 'RIGHT EYE RESULT: SUSPECTED ODE. FURTHER REVIEW RECOMMENDED.';
    
    resultLeft.textContent = analysisResults.left;
    resultRight.textContent = analysisResults.right;
    
    resultLeft.style.display = 'block';
    resultRight.style.display = 'block';
    
    alertUser("Analysis simulated.");
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

    // 3. Analysis Results
    document.getElementById('overview-analysis-left').textContent = analysisResults.left;
    document.getElementById('overview-analysis-right').textContent = analysisResults.right;

    // 4. TLX Review and Comments
    const tlxContainer = document.getElementById('overview-tlx-results');
    tlxContainer.innerHTML = '';
    
    if (Object.keys(tlxAnswers).length === 0) {
            // Should not happen if navigation is correct, but re-capture if necessary
            captureTLXAnswers(); 
    }

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
    document.getElementById('backFromAnalysisBtn')?.addEventListener('click', () => navigateTo(3));
    document.getElementById('toQuestionnaireBtn')?.addEventListener('click', () => navigateTo(5));

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
