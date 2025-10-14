# Web Application for Object Detection and Classification of Optic Discs
<p align="center">
<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/DLR_Logo.svg/1225px-DLR_Logo.svg.png" width=50 height=50>
<img src="https://brand.esa.int/files/2020/05/ESA_logo_2020_Deep-scaled.jpg" width=80 height=50>
</p>
This folder contains the code of the web application that performs object detection and classification of an optic disc using deep learning models. 


### Directory Structure
The following is the directory structure of the project:
<ul>
<li>media/: This directory contains images and videos used in the web application. In this case, there is only one relevant image named background.jpg which is used as the background of the web application.</li>
<li>models/: This directory contains the files of the models that perform classification and object detection. It contains the following subdirectories and files:
<ul><li>classification/: This directory contains the model for optic disc classification. The model is split into 62 binary files, named group1-shard1of62.bin, group1-shard2of62.bin, and so on, and a JSON file named model.json.
<li>classificationLight/: This directory contains a lighter version of the classification model, split into three binary files and a JSON file.</li>
<li>mobileNet/: This directory contains a pre-trained MobileNet model, which is a convolutional neural network used for image classification. The model is split into binary files and a JSON file named model.json.</li>
<li>objectDetection/: This directory contains a pre-trained model for object detection using the SSD mobilenet model. The model is split into five binary files and a JSON file named model.json.</li>
</ul>
<li>index.html: This is the main HTML file of the web application, which defines the structure of the web page.</li>
<li>index.js: This is the main JavaScript file of the web application, which describe the logic, handles user interaction and communicates with the pre-trained models.</li>
<li>style.css: This is the main CSS file of the web application, which contains its style.</li>
</ul>

### Requirements
To run this web application, you need the following:
<ul>
<li>A modern web browser that supports JavaScript. The Chrome web browser is recommended.
Safari is not supported in the following code if you want to switch the camera.
</li>
<li>
The ngrok application to expose the web service. The executable file is already provided in the repo.
Other guidelines to install it are available <a href="https://ngrok.com/download">here</a>.
</li>
<li>
Services like the npm http-server to access the web service. Information regarding the installation can be found <a href="https://github.com/http-party/http-server">here.</a>
</li>
</ul>

### Getting Started
To use this web application, follow these steps:
<ol>
<li>Clone this repository to your local machine.</li>
<li>Launch a http server on your local machine in the Web Application folder, for example using npm:
<pre>
http-server
</pre>
</li>
<li>You can use ngrok to expose the web service to the Internet. The server will be hosted by default on port 8080.
<pre>
./ngrok http 8080
</pre>
</li></ol>

### How to use the web app
<ol>
<li>
Open index.html (on localhost or the URL provided by ngrok) in a web browser to launch the web application.
</li>
<li>
Let the model access your camera and plug the object detection model to start using the application. </li>
<li> Use the X button to remove low-quality images. </li>
<li> Use the classify button to receive the diagnosis. </li>
</ol>

### Simpler version
The **light** folder contains a lighter version of the web app, suited for users that do not want to set thresholds and want a simpler UI.
The same steps described before in "Getting started" should be done in _Web Application/light_ folder to use this other version of the web app.

### Tutorial
<p align="center">
<img src="../media/tutorial0.png" width=900 height=350>
&nbsp;</p>
<p align="center">
<img src="../media/tutorial1.png" width=900 height=350>
&nbsp;</p>
<p align="center">
<img src="../media/tutorial2.png" width=900 height=350>
&nbsp;</p>
<p align="center">
<img src="../media/tutorial3.png" width=900 height=350>
&nbsp;</p>




