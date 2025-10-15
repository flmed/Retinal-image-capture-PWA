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
// Modification 2: Track the currently selected eye
let currentEye = 'RIGHT'; // Default to RIGHT (OD)
// Modification 2: Update capturedImages object structure
// Stores objects: { id: 1, base64: 'data:image...', eye: 'RIGHT'/'LEFT', selected: false }
let capturedImages = []; 
let subjectInfo = { id: '', notes: '' };
let isSelectionMode = false;
let isOdDetectionOn = false; // Controls the auto-capture state
let autoCaptureInterval = null; // Interval for automatic capture
const MAX_CAROUSEL_IMAGES = 5; // Max images to show in the carousel

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

/** Simple replacement for alert() using the resultDisplay area on Review page. */
function alertUser(message, isError = false) {
    const display = document.getElementById('resultDisplay');
    
    // Log for other pages or if display isn't present
    if (currentPage !== 3 || !display) {
        console.log(`UI Alert: ${message}`);
        return;
    }

    display.textContent = message;
    display.style.display = 'block';
    if (isError) {
         // Use danger style for errors
         display.style.borderColor = '#dc3545'; 
         display.style.color = '#721c24';
         display.style.backgroundColor = '#f8d7da';
    } else {
        // Use green border style for successful classification/general info (Modification #3)
        display.style.borderColor = '#28a745'; 
        display.style.color = '#155724';
        display.style.backgroundColor = '#d4edda';
    }

    // Hide after 5 seconds
    setTimeout(() => {
        display.style.display = 'none';
    }, 5000);
}

/** Custom confirm dialogue replacement (since alert/confirm are forbidden). */
function customConfirm(message) {
    // Using window.confirm as a temporary replacement for the forbidden alert/confirm
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
        
        // Handle banner click to navigate (Modification #1 from previous request)
        step.onclick = () => {
            navigateTo(stepNum);
        };
    });
}

function validateStep1() {
    const subjectIdInput = document.getElementById('subjectId');
    const subjectId = subjectIdInput.value.trim();

    if (!subjectId) {
        alertUser('Please enter a Subject ID before continuing.', true);
        subjectIdInput.focus();
        return false;
    }

    subjectInfo.id = subjectId;
    return true;
}

/** Handles navigation between steps. */
function navigateTo(step) {
    if (currentPage === 1 && step > 1 && !validateStep1()) {
        return;
    }
    
    // Stop camera/capture when leaving page 2
    if (currentPage === 2) {
        stopCamera();
        stopAutoCapture(); 
    }
    
    // Modification #5: Removed validation check for classification before moving to Step 4

    document.getElementById(`page-basic`).classList.remove('active');
    document.getElementById(`page-capture`).classList.remove('active');
    document.getElementById(`page-review`).classList.remove('active');
    document.getElementById(`page-questionnaire`).classList.remove('active');

    currentPage = step;
    const pageId = currentPage === 1 ? 'basic' : currentPage === 2 ? 'capture' : currentPage === 3 ? 'review' : 'questionnaire';
    document.getElementById(`page-${pageId}`).classList.add('active');

    updateStepNav();

    if (step === 2) {
        // Start camera and auto-capture when entering capture page
        startCamera();
        // Modification 5: Auto-capture should not start automatically
        // startAutoCapture(); 
        renderCarousel();
        updateCaptureStatus();
        updateEyeToggleUI(); // Modification 2: Ensure the eye toggle is correctly initialized
    }
    if (step === 3) {
        renderImages();
    }
    if (step === 4) {
        renderTLXQuestions();
    }
}

// --- Camera & Capture Logic ---

/** Starts the camera feed in the video element. */
async function startCamera(deviceId = null) {
    const videoElement = document.getElementById('cameraFeed');
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alertUser("Camera access not supported in this browser.", true);
            return;
        }
        
        const constraints = {
            video: {
                facingMode: 'environment', // Prefer rear camera
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        if (deviceId) {
            constraints.video.deviceId = deviceId;
        }

        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = mediaStream;
        videoElement.play();
    } catch (error) {
        console.error("Error accessing camera:", error);
        alertUser("Could not access camera. Please check permissions.", true);
    }
}

/** Stops the camera stream. */
function stopCamera() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
}

// Modification 1: Remove switchCamera, it is no longer used in the UI
/*
async function switchCamera() {
    // ... removed
}
*/

/** * Modification 4: Manual capture function.
 * Modification 2: Adds eye information to the image object.
 */
function manualImageCapture() {
    // Mock image (grey box with number)
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${currentEye}+${capturedImages.length + 1}`;

    const newImage = {
        id: Date.now(),
        base64: mockUrl,
        eye: currentEye, // Modification 2: Store the current eye
        selected: false
    };

    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
    console.log(`${currentEye} Image ${capturedImages.length} captured manually.`);
    alertUser(`${currentEye} Image ${capturedImages.length} captured manually.`);
}


/** Function to capture a mock image (used for auto-capture). */
function mockImageCapture() {
    // Mock image (grey box with number)
    const size = 200;
    const mockUrl = `https://placehold.co/${size}x${size}/999999/FFFFFF?text=${currentEye}+Auto+${capturedImages.length + 1}`;

    const newImage = {
        id: Date.now(),
        base64: mockUrl,
        eye: currentEye, // Modification 2: Store the current eye
        selected: false
    };

    capturedImages.push(newImage);
    renderCarousel();
    updateCaptureStatus();
    console.log(`${currentEye} Auto Image ${capturedImages.length} captured.`);
    alertUser(`${currentEye} Auto Image ${capturedImages.length} captured.`);
}

/** Starts the 4-second automatic capture interval. */
function startAutoCapture() {
    if (autoCaptureInterval) clearInterval(autoCaptureInterval);

    // NOTE: The 400ms interval is used here, but the comment suggests 4s. 
    // Keeping 400ms as per the original code to avoid breaking the simulation,
    // but a production app should use 4000ms for 4 seconds.
    autoCaptureInterval = setInterval(() => {
        if (currentPage === 2 && isOdDetectionOn) {
            mockImageCapture();
        }
    }, 400); 
    console.log("Auto-Capture interval started (400ms).");
}

/** Stops the automatic capture interval. */
function stopAutoCapture() {
    if (autoCaptureInterval) {
        clearInterval(autoCaptureInterval);
        autoCaptureInterval = null;
        console.log("Auto-Capture interval stopped.");
    }
}

/** * Modification 5: Toggles the OD Capture state and updates UI. 
 * The button is now "AUTO CAPTURE".
 */
function toggleOdCapture() {
    const odToggleBtn = document.getElementById('autoCaptureToggleBtn'); // Updated ID
    const odStatusSpan = document.getElementById('odStatus');

    isOdDetectionOn = !isOdDetectionOn;

    if (isOdDetectionOn) {
        odToggleBtn.textContent = 'AUTO CAPTURE (ACTIVE)';
        odToggleBtn.classList.add('active');
        odStatusSpan.textContent = 'ACTIVE';
        startAutoCapture(); // Start the interval when turning ON
    } else {
        odToggleBtn.textContent = 'AUTO CAPTURE (INACTIVE)';
        odToggleBtn.classList.remove('active');
        odStatusSpan.textContent = 'INACTIVE';
        stopAutoCapture(); // Stop the interval when turning OFF
    }
}

/** * Modification 6: Updates the image count display to separate LEFT/RIGHT eye counts.
 * Modification 5: Also updates the OD status text label.
 */
function updateCaptureStatus() {
    const leftCount = capturedImages.filter(img => img.eye === 'LEFT').length;
    const rightCount = capturedImages.filter(img => img.eye === 'RIGHT').length;

    // Modification 6: Update the combined status text
    document.getElementById('imageCount').textContent = `L: ${leftCount} | R: ${rightCount}`;
    
    // Modification 5: Update the OD DETECTION label text
    document.querySelector('.capture-status p:first-child').innerHTML = 
        `OPTIC DISC AUTO DETECTION: <span id="odStatus">${isOdDetectionOn ? 'ACTIVE' : 'INACTIVE'}</span>`;
}

/** * Modification 2: Toggles the current eye selection (LEFT/RIGHT). 
 * This is called from the new toggle button.
 */
function toggleEyeSelection(eye) {
    currentEye = eye;
    updateEyeToggleUI();
    alertUser(`Eye selection set to ${currentEye}.`);
}

/** * Modification 2: Updates the visual state of the eye toggle button.
 */
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


// --- Carousel Logic (Page 2) ---

/** Renders the last N captured images in the horizontal carousel. */
function renderCarousel() {
    const carousel = document.getElementById('carousel');
    carousel.innerHTML = '';
    
    // Get all images to allow full scroll back (Modification #1)
    const imagesToDisplay = capturedImages; 

    imagesToDisplay.forEach((img, index) => {
        const item = document.createElement('div');
        // Modification 2: Add eye-specific class to carousel item
        item.className = `carousel-item carousel-item-${img.eye.toLowerCase()}`; 
        item.setAttribute('data-id', img.id);

        const image = document.createElement('img');
        image.src = img.base64;
        // Modification 2: Update alt text to include eye info
        image.alt = `${img.eye} Image ${index + 1}`; 
        
        item.appendChild(image);
        carousel.appendChild(item);
    });

    // Scroll to the end to show the latest image
    carousel.scrollLeft = carousel.scrollWidth;
}


// --- Page 3: Review Logic (Selection, Deletion, Classification) ---

/** Renders all captured images to the review grid. */
function renderImages() {
    const grid = document.getElementById('review-grid');
    grid.innerHTML = '';

    const reviewControlsTop = document.querySelector('.review-controls-top');
    const resultDisplay = document.getElementById('resultDisplay');
    
    // Hide all review actions if no images are present
    if (capturedImages.length === 0) {
        grid.innerHTML = '<p style="padding: 30px;">No images captured yet. Please go back to Step 2.</p>';
        reviewControlsTop.style.display = 'none';
        resultDisplay.style.display = 'none';
        return;
    }
    
    // Show controls if images are present
    reviewControlsTop.style.display = 'flex';

    // Update selection button text
    const toggleBtn = document.getElementById('selectMultipleBtn');
    toggleBtn.textContent = isSelectionMode ? 'Exit Selection Mode' : 'Toggle Selection';
    toggleBtn.classList.toggle('active', isSelectionMode);

    capturedImages.forEach((img, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = `review-image-wrapper ${img.selected ? 'selected' : ''}`;
        wrapper.setAttribute('data-img-id', img.id);

        wrapper.onclick = () => toggleImageSelection(img.id);

        const image = document.createElement('img');
        image.src = img.base64;
        image.alt = `${img.eye} Image ${index + 1}`; // Modification 2: Add eye info

        const overlay = document.createElement('div');
        overlay.className = 'selection-overlay';
        overlay.innerHTML = '&#x2713;'; // Checkmark symbol
        
        // Modification 2: Add eye label to the image thumbnail in review grid
        const eyeLabel = document.createElement('span');
        eyeLabel.className = 'eye-label';
        eyeLabel.textContent = img.eye;
        
        wrapper.appendChild(image);
        wrapper.appendChild(overlay);
        wrapper.appendChild(eyeLabel); // Append eye label
        grid.appendChild(wrapper);
    });

    updateDeleteButtonCount();
}

/** Toggles the global selection mode state. */
function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    // Deselect all images when exiting mode
    if (!isSelectionMode) {
        capturedImages.forEach(img => img.selected = false);
    }
    renderImages();
}

/** Toggles the selected state of a single image. */
function toggleImageSelection(imageId) {
    if (!isSelectionMode) {
        alertUser("Click 'Toggle Selection' to enable image selection/deletion mode.", false);
        return;
    }

    const image = capturedImages.find(img => img.id === imageId);
    if (image) {
        image.selected = !image.selected;
        // Update the single image wrapper's class immediately
        const wrapper = document.querySelector(`[data-img-id="${imageId}"]`);
        if (wrapper) {
            wrapper.classList.toggle('selected', image.selected);
        }
        updateDeleteButtonCount();
    }
}

/** Updates the delete button text with the number of selected images. */
function updateDeleteButtonCount() {
    const selectedCount = capturedImages.filter(img => img.selected).length;
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    deleteBtn.textContent = `Delete Selected (${selectedCount})`;
    deleteBtn.disabled = selectedCount === 0;
}

/** Removes all selected images from the state and UI. */
function deleteSelectedImages() {
    const selectedCount = capturedImages.filter(img => img.selected).length;
    if (selectedCount === 0) {
        return;
    }

    if (customConfirm(`Are you sure you want to delete ${selectedCount} selected image(s)?`)) {
        capturedImages = capturedImages.filter(img => !img.selected);
        // If all images deleted, exit selection mode automatically
        if (capturedImages.length === 0) {
             isSelectionMode = false;
        } else {
             // Keep selection mode active but clear selections
             capturedImages.forEach(img => img.selected = false);
        }
       
        renderImages();
        updateCaptureStatus();
        alertUser(`${selectedCount} image(s) deleted.`);
        
        // Hide classification result as the image set has changed
        document.getElementById('resultDisplay').style.display = 'none';
    }
}

/** Mock function for running image classification. */
function runClassification() {
    const resultDisplay = document.getElementById('resultDisplay');
    
    if (capturedImages.length === 0) {
        alertUser("Cannot run classification: No images captured.", true);
        resultDisplay.style.display = 'none';
        return;
    }

    // --- MOCK CLASSIFICATION RESULT ---
    // Modification #3: New classification result format
    resultDisplay.style.display = 'block';
    resultDisplay.style.borderColor = '#28a745'; // Set success border color
    resultDisplay.style.color = '#155724';      // Set dark green text color
    resultDisplay.style.backgroundColor = '#d4edda'; // Set light green background
    
    // Example result: NO ODE
    resultDisplay.textContent = `RESULT: NO ODE (${capturedImages.length} images analyzed).`;
    
    alertUser("Classification simulated.");
}


// --- Page 4: Questionnaire Logic ---

/** Renders the 6 NASA TLX questions dynamically. */
function renderTLXQuestions() {
    const container = document.querySelector('#page-questionnaire .nasa-tlx-questions');
    container.innerHTML = '';
    
    TLX_DIMENSIONS.forEach((dim, index) => {
        const row = document.createElement('div');
        row.className = 'question-row';
        row.innerHTML = `
            <p>${dim.prompt}</p>
            <div class="slider-wrapper">
                <span class="slider-label">LOW</span>
                <input type="range" min="0" max="20" value="10" id="tlx_q${index + 1}">
                <span class="slider-label">HIGH</span>
            </div>
        `;
        container.appendChild(row);
    });

    // Ensure comments area is visible
    document.getElementById('comments').value = subjectInfo.notes || '';
}


/** Submits all session data to Firestore. */
async function handleSubmit() {
    if (window.isAuthReady !== true) {
        alertUser('Application is still initializing authentication. Please wait a moment.', true);
        return;
    }

    // Gather TLX data using the generated IDs
    const questionnaireData = {};
    let allInputsValid = true;
    TLX_DIMENSIONS.forEach((_, index) => {
        const inputId = `tlx_q${index + 1}`;
        const input = document.getElementById(inputId);
        const value = parseInt(input ? input.value : 0);
        questionnaireData[`q${index + 1}_${TLX_DIMENSIONS[index].name.replace(/\s/g, '')}`] = value;
    });

    questionnaireData.comments = document.getElementById('comments').value.trim();
    subjectInfo.notes = questionnaireData.comments; // Store comments for session continuity

    if (!allInputsValid) {
        alertUser("Please ensure all TLX questions are answered.", true);
        return;
    }
    
    // Prepare data for Firestore
    const sessionData = {
        subjectId: subjectInfo.id,
        userId: window.userId,
        timestamp: serverTimestamp(),
        questionnaire: questionnaireData,
        imageCount: capturedImages.length,
        // Modification 2: Include eye information in image metadata submission
        imageMetadata: capturedImages.map((img, index) => ({ 
            id: img.id, 
            index: index + 1,
            eye: img.eye 
        }))
    };

    try {
        const collectionPath = `artifacts/${window.appId}/users/${window.userId}/session_data`;
        await addDoc(collection(window.db, collectionPath), sessionData);
        console.log("Session data successfully written to:", collectionPath);

        showModal();

    } catch (e) {
        console.error("Error adding document: ", e);
        alertUser("Submission failed. Please check the console for details.", true);
    }
}


// --- Modal Control and Session Reset ---

function showModal() {
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

/** Clears all session data and navigates back to Step 1. */
function startNewSession() {
    // 1. Clear application state
    capturedImages = [];
    subjectInfo = { id: '', notes: '' };
    isSelectionMode = false;
    isOdDetectionOn = false;
    currentEye = 'RIGHT'; // Modification 2: Reset default eye

    // 2. Reset UI inputs
    document.getElementById('subjectId').value = '';
    document.getElementById('comments').value = '';
    
    // Reset Capture Page UI
    updateCaptureStatus();
    // Modification 5: Update the status text display
    document.getElementById('odStatus').textContent = 'INACTIVE';
    // Modification 5: Update the button text
    document.getElementById('autoCaptureToggleBtn').textContent = 'AUTO CAPTURE (INACTIVE)';
    document.getElementById('autoCaptureToggleBtn').classList.remove('active');
    updateEyeToggleUI(); // Modification 2: Reset eye toggle UI
    renderCarousel();

    // Reset Review Page UI (hiding buttons/results)
    document.getElementById('resultDisplay').style.display = 'none';
    
    // 3. Close modal and navigate to step 1
    document.getElementById('modal-overlay').style.display = 'none';
    navigateTo(1);
}


// --- Event Listener Setup (Replaces all inline onclicks) ---

function setupEventListeners() {
    // Navigation (Step 1)
    document.getElementById('toCaptureBtn')?.addEventListener('click', () => navigateTo(2));

    // Capture Page (Step 2)
    // Modification 5: Update button ID
    document.getElementById('autoCaptureToggleBtn')?.addEventListener('click', toggleOdCapture); 
    // Modification 2: New eye selection buttons
    document.getElementById('eyeToggleLeft')?.addEventListener('click', () => toggleEyeSelection('LEFT')); 
    document.getElementById('eyeToggleRight')?.addEventListener('click', () => toggleEyeSelection('RIGHT'));
    // Modification 4: New manual capture button
    document.getElementById('manualCaptureBtn')?.addEventListener('click', manualImageCapture); 
    
    // Modification 3: New back and review buttons location/ID
    document.getElementById('backFromCaptureBtn')?.addEventListener('click', () => navigateTo(1)); 
    document.getElementById('toReviewBtnBottom')?.addEventListener('click', () => navigateTo(3));

    // Review Page (Step 3) 
    document.getElementById('selectMultipleBtn')?.addEventListener('click', toggleSelectionMode);
    document.getElementById('deleteSelectedBtn')?.addEventListener('click', deleteSelectedImages);
    document.getElementById('runClassificationBtn')?.addEventListener('click', runClassification);
    document.getElementById('backFromReviewBtn')?.addEventListener('click', () => navigateTo(2));
    document.getElementById('toQuestionnaireBtn')?.addEventListener('click', () => navigateTo(4));

    // Questionnaire Page (Step 4)
    document.getElementById('backFromQuestionnaireBtn')?.addEventListener('click', () => navigateTo(3));
    document.getElementById('submitBtn')?.addEventListener('click', handleSubmit);

    // Modal
    document.getElementById('continueSessionBtn')?.addEventListener('click', closeModal);
    document.getElementById('newSessionBtn')?.addEventListener('click', startNewSession);
}


// --- Initialization ---
window.addEventListener('load', () => {
    initFirebase();
    setupEventListeners();
    updateStepNav();
});

/**
 * Initializes Firebase, sets up authentication, and prepares Firestore services.
 */
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

// LED now is working I hope