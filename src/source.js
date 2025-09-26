// === IMPORTS ===
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { forceSimulation, forceManyBody, forceLink, forceCenter } from 'd3-force-3d';

// === SCENE SETUP ===
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 80;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// === LIGHTS ===
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

// === TOOLTIP ===
const tooltip = document.createElement('div');
tooltip.style.position = 'absolute';
tooltip.style.visibility = 'hidden';
tooltip.style.padding = '6px';
tooltip.style.background = 'rgba(0,0,0,0.7)';
tooltip.style.color = 'white';
tooltip.style.fontSize = '12px';
tooltip.style.borderRadius = '4px';
tooltip.style.pointerEvents = 'none';
document.body.appendChild(tooltip);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// === GRAPH GROUP ===
const graphGroup = new THREE.Group();
scene.add(graphGroup);

// === AXES ===
const axisLength = 40;
// === FONT LOADER ===
let loadedFont = null;
const fontLoader = new FontLoader();
fontLoader.load('/src/fonts/helvetiker_regular.typeface.json', (font) => {
  loadedFont = font;

});

// === FORCE SIMULATION ===
let simulation = null;
let currentGraph = { nodes: [], links: [] };


// === RENDER GRAPH DATA ===
function renderGraph3D(graph) {
  if (!loadedFont) {
    console.warn("Font not loaded yet, skipping render");
    return;
  }

  currentGraph = graph;
  graphGroup.clear();

  // === init node meshes ===
  graph.nodes.forEach((n) => {
    const textGeo = new TextGeometry(n.id, { font: loadedFont, size: 3, depth: 0.1 });
    textGeo.computeBoundingBox();
    textGeo.center();
    const textMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const textMesh = new THREE.Mesh(textGeo, textMat);

    textMesh.userData = { id: n.id, isNode: true, links: [] };
    graphGroup.add(textMesh);
    n.mesh = textMesh;

    // random 3D starting positions
    n.x = (Math.random() - 0.5) * axisLength;
    n.y = (Math.random() - 0.5) * axisLength;
    n.z = (Math.random() - 0.5) * axisLength;
  });

  // === link binding ===
  graph.links.forEach((l) => {
    l.sourceObj = graph.nodes.find(n => n.id === l.source);
    l.targetObj = graph.nodes.find(n => n.id === l.target);
  });

  // === setup min/max for gradient ===
  const weights = graph.links.map(l => (l.weight ?? l.value) || 1);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);


  function getColorForWeight(weight, min, max) {
    const t = (weight - min) / (max - min || 1); // normalize 0–1
    const r = Math.floor(255 * t);
    const g = 0;
    const b = Math.floor(255 * (1 - t));
    return (r << 16) | (g << 8) | b;
  }

  // === create link objects ONCE ===
  graph.links.forEach(l => {
    if (!l.sourceObj || !l.targetObj) return;

    const geometry = new THREE.BufferGeometry().setFromPoints([
      l.sourceObj.mesh.position,
      l.targetObj.mesh.position
    ]);

  const weight = (l.weight ?? l.value) || 1;
    const color = getColorForWeight(weight, minWeight, maxWeight);
    const colorHex = color; // color already in 0xRRGGBB int form

    const lineMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geometry, lineMat);

    line.userData = { source: l.sourceObj, target: l.targetObj, weight, originalColor: colorHex };
    graphGroup.add(line);

    if (l.sourceObj.mesh) l.sourceObj.mesh.userData.links.push(line);
    if (l.targetObj.mesh) l.targetObj.mesh.userData.links.push(line);

    l.line = line; // save reference for updates
  });

  // === setup 3D force simulation ===
  if (simulation) simulation.stop();

  simulation = forceSimulation(graph.nodes)
    .force("charge", forceManyBody().strength(-200))
    .force("link", forceLink(graph.links).id(d => d.id).distance(40))
    .force("center", forceCenter(0, 0, 0))
    .alphaDecay(0.01)
    .on("tick", () => {
      // update nodes
      graph.nodes.forEach(n => {
        if (n.mesh) {
          n.mesh.position.set(n.x, n.y, n.z);
        }
      });

      // update link positions instead of recreating
      graph.links.forEach(l => {
        if (!l.sourceObj || !l.targetObj) return;

        const p1 = l.sourceObj.mesh.position;
        const p2 = l.targetObj.mesh.position;

        const weight = (l.weight ?? l.value) || 1;
        const color = getColorForWeight(weight, minWeight, maxWeight);
        const colorHex = color;

        if (l.line && l.line.geometry && l.line.geometry.attributes && l.line.geometry.attributes.position) {
          // update existing geometry positions
          const posAttr = l.line.geometry.attributes.position;
          if (posAttr.count >= 2) {
            posAttr.setXYZ(0, p1.x, p1.y, p1.z);
            posAttr.setXYZ(1, p2.x, p2.y, p2.z);
            posAttr.needsUpdate = true;
          } else {
            // fallback: rebuild positions
            l.line.geometry.setFromPoints([p1, p2]);
          }
          // update color (weight-based)
          l.line.material.color.set(colorHex);
          l.line.userData.weight = weight;
        } else {
          // create it if missing
          const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
          const lineMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9 });
          const line = new THREE.Line(geometry, lineMat);
          line.userData = { source: l.sourceObj, target: l.targetObj, weight, originalColor: colorHex };
          graphGroup.add(line);
          if (l.sourceObj.mesh) l.sourceObj.mesh.userData.links.push(line);
          if (l.targetObj.mesh) l.targetObj.mesh.userData.links.push(line);
          l.line = line;
        }
      });
    });
}


// === SUBMIT DREAM ===
function submitDream() {
  const textElem = document.getElementById('dreamInput');
  const dreamText = textElem ? textElem.value : '';

  fetch('http://127.0.0.1:5050/api/submit', {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dream: dreamText }),
  })
    .then((res) => res.json())
    .then((data) => {
      renderGraph3D(data.graph);
    })
    .catch((err) => console.error('Fetch error:', err));
}

// === INITIAL LOAD ===
function loadInitialGraph() {
  fetch('http://127.0.0.1:5050/api/graph')
    .then((res) => res.json())
    .then((graph) => {
      renderGraph3D(graph);
    })
    .catch((err) => console.error("Graph load error:", err));
}

// === INTERACTION ===
let highlightedNode = null;

window.addEventListener('mousemove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(graphGroup.children.filter((o) => o.userData.isNode), false);

  if (intersects.length > 0) {
    const obj = intersects[0].object;

    tooltip.innerHTML = obj.userData.id;
    tooltip.style.visibility = 'visible';
    const vector = new THREE.Vector3();
    obj.getWorldPosition(vector);
    vector.project(camera);
    tooltip.style.left = `${(vector.x * 0.5 + 0.5) * window.innerWidth + 10}px`;
    tooltip.style.top = `${(vector.y * -0.5 + 0.5) * window.innerHeight + 10}px`;

    if (highlightedNode !== obj) {
      resetHighlights();
      obj.material.color.set(0xffff00);
      if (obj.userData.links) {
        obj.userData.links.forEach(line => {
          line.material.color.set(0xffff00);
        });
      }
      highlightedNode = obj;
    }
  } else {
    tooltip.style.visibility = 'hidden';
    resetHighlights();
  }
});

function resetHighlights() {
  graphGroup.children.forEach(child => {
    if (child.userData.isNode) child.material.color.set(0xffffff);
    if (child.type === "Line") {
      const orig = child.userData && child.userData.originalColor ? child.userData.originalColor : 0x888888;
      try {
        child.material.color.set(orig);
        child.material.opacity = 0.9;
      } catch (e) {
        // ignore
      }
    }
  });
  highlightedNode = null;
}

// === ANIMATION LOOP ===
function animate() {
  requestAnimationFrame(animate);

  graphGroup.children.forEach((child) => {
    if (child.userData.isNode) {
      child.lookAt(camera.position);
    }
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.submitDream = submitDream;
loadInitialGraph();
