import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, onSnapshot, collection, serverTimestamp, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Global Firebase Variables ---
window.db = null;
window.auth = null;
window.userId = null;
window.appId = null;
window.isAuthReady = false;
let mediaStream = null; // To hold the camera stream

setLogLevel('Debug');

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
        
        // MODIFICATION: Request torch based on 'isTorchOn' state (default is true)
        const constraints = { 
            video: { 
                facingMode: 'environment', // Prefer environment camera
                width: { ideal: 1280 }, 
                height: { ideal: 720 },
                // Request torch if isTorchOn is true
                advanced: [{ torch: isTorchOn }] 
            } 
        };
        if (targetDeviceId) { constraints.video.deviceId = targetDeviceId; }
        
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
            isTorchOn = settings.torch || isTorchOn; // Update state based on current settings if available
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
function manualImageCapture() {
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${currentEye}+${capturedImages.length + 1}`;
    const newImage = { id: Date.now(), base64: mockUrl, eye: currentEye, selected: false };
    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
}
function mockImageCapture() {
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${currentEye}+Auto+${capturedImages.length + 1}`;
    const newImage = { id: Date.now(), base64: mockUrl, eye: currentEye, selected: false };
    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
}
function startAutoCapture() {
    if (autoCaptureInterval) clearInterval(autoCaptureInterval);
    autoCaptureInterval = setInterval(() => {
        if (currentPage === 2 && isOdDetectionOn) {
            mockImageCapture();
        }
    }, 400); 
}
function stopAutoCapture() {
    if (autoCaptureInterval) {
        clearInterval(autoCaptureInterval);
        autoCaptureInterval = null;
    }
}
function toggleOdCapture() {
    const odToggleBtn = document.getElementById('autoCaptureToggleBtn');
    const odStatusSpan = document.getElementById('odStatus');
    isOdDetectionOn = !isOdDetectionOn;
    if (isOdDetectionOn) {
        odToggleBtn.textContent = 'AUTO CAPTURE (ACTIVE)';
        odToggleBtn.classList.add('active');
        odStatusSpan.textContent = 'ACTIVE';
        startAutoCapture();
    } else {
        odToggleBtn.textContent = 'AUTO CAPTURE (INACTIVE)';
        odToggleBtn.classList.remove('active');
        odStatusSpan.textContent = 'INACTIVE';
        stopAutoCapture();
    }
}
function updateCaptureStatus() {
    const leftCount = capturedImages.filter(img => img.eye === 'LEFT').length;
    const rightCount = capturedImages.filter(img => img.eye === 'RIGHT').length;
    document.getElementById('imageCount').textContent = `L: ${leftCount} | R: ${rightCount}`;
    document.querySelector('.capture-status p:first-child').innerHTML = 
        `OPTIC DISC AUTO DETECTION: <span id="odStatus">${isOdDetectionOn ? 'ACTIVE' : 'INACTIVE'}</span>`;
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
        image.alt = `${img.eye} Image ${index + 1}`; 
        item.appendChild(image);
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
        image.alt = `${img.eye} Image`;
        const overlay = document.createElement('div');
        overlay.className = 'selection-overlay';
        overlay.innerHTML = '&#x2713;';
        wrapper.appendChild(image);
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
    // MODIFICATION 2: Update info display
    document.getElementById('lightbox-info').textContent = `EYE: ${img.eye}`;
    // MODIFICATION 2: Update select button appearance
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

// MODIFICATION 2: New function to delete image from lightbox
function deleteImageFromLightbox() {
    const currentImg = lightboxImageSet[lightboxCurrentIndex];
    if (customConfirm(`Are you sure you want to delete this image?`)) {
        // Remove from the main array
        capturedImages = capturedImages.filter(img => img.id !== currentImg.id);
        
        // Update capture status
        updateCaptureStatus();
        alertUser('Image deleted.');
        
        // Close lightbox and re-render the underlying page
        closeLightbox();
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
                const imageEl = document.createElement('img');
                imageEl.src = img.base64;
                container.appendChild(imageEl);
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
}


// --- Initialization ---
window.addEventListener('load', () => {
    initFirebase();
    setupEventListeners();
    updateStepNav();
});

async function initFirebase() {
    try {
        window.appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase configuration is missing.");
            return;
        }
        const firebaseApp = initializeApp(firebaseConfig);
        window.db = getFirestore(firebaseApp);
        window.auth = getAuth(firebaseApp);
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        if (initialAuthToken) {
            await signInWithCustomToken(window.auth, initialAuthToken);
        } else {
            await signInAnonymously(window.auth);
        }
        onAuthStateChanged(window.auth, (user) => {
            if (user) {
                window.userId = user.uid;
            } else {
                window.userId = crypto.randomUUID();
            }
            window.isAuthReady = true;
            console.log("Firebase Auth Ready. User ID:", window.userId);
        });
    } catch (error) {
        console.error("Firebase initialization failed:", error);
    }
}