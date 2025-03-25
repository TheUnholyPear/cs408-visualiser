import * as d3 from 'd3';
import introJs from 'intro.js';

document.addEventListener("DOMContentLoaded", function() {
    // Global Variables
    let nodes = [];
    let links = [];
    let nextId = 0;
    let adjacency = {};
    let currentPath = null;

    // Array to store history steps and current step index
    let historySteps = [];
    let currentStepIndex = -1;
    let currentParents = {};

    // Set a default selected algorithm
    let selectedAlgorithm = null;

    // Node sizes
    const outerRadius = 24;
    const innerRadius = 20;

    // Logs
    const stepsList = document.getElementById("stepsList");

    // Interrupts
    let allTimeouts = [];
    let isAlgorithmRunning = false;

    // Container dimensions
    const svgEl = document.getElementById("graphSvg");
    let width = svgEl.clientWidth;
    let height = svgEl.clientHeight;

    // D3 Setup
    const svg = d3.select("#graphSvg");
    svg.attr("width", width)
        .attr("height", height);

    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const labelGroup = svg.append("g").attr("class", "labels");


    // Toast initialization for current step
    const currentStepToastEl = document.getElementById('currentStepToast');
    const currentStepToast = new bootstrap.Toast(currentStepToastEl, {
        autohide: false,
        animation: false
    });

    // ───────── Helper Functions ─────────

    // Helper: Normalize a link endpoint (could be a node object or a number)
    function normalizeEndpoint(x) {
        return (typeof x === "object" ? x.id : x);
    }

    // Helper: wipe node cost labels
    function wipeCosts() {
        nodes.forEach(n => { n.cost = undefined; });
        d3.selectAll(".node-group")
            .select(".cost-label")
            .text("");
    }

    // Helper: wipe links and any weights
    function wipeLinksAndWeights() {
        links = [];
        linkGroup.selectAll(".link").remove();
        labelGroup.selectAll(".link-label").remove();
    }

    // Draw/redo graph
    let linkSelection, nodeSelection, linkLabelSelection;
    function drawGraph() {
        // LINKS
        linkSelection = linkGroup.selectAll(".link")
            .data(links, link => `${normalizeEndpoint(link.source)}-${normalizeEndpoint(link.target)}`);
        linkSelection.exit().remove();
        linkSelection = linkSelection.enter()
            .append("line")
            .attr("class", "link")
            .merge(linkSelection);

        // Link Labels (if weight exists)
        linkLabelSelection = labelGroup.selectAll(".link-label")
            .data(links.filter(l => l.weight !== undefined), link => `${normalizeEndpoint(link.source)}-${normalizeEndpoint(link.target)}`);
        linkLabelSelection.exit().remove();
        const linkLabelEntering = linkLabelSelection.enter()
            .append("text")
            .attr("class", "link-label")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("pointer-events", "none")
            .text(d => d.weight);
        linkLabelSelection = linkLabelEntering.merge(linkLabelSelection);

        // NODES
        nodeSelection = nodeGroup.selectAll(".node-group")
            .data(nodes, node => node.id);
        nodeSelection.exit().remove();

        const nodeEntering = nodeSelection.enter()
            .append("g")
            .attr("class", "node-group")
            .call(d3.drag()
                .on("drag", (event, node) => {
                    updateContainerSize();
                    node.x = event.x;
                    node.y = event.y;
                    constrainNode(node);
                    updatePositions();
                })
            );

        // Outer circle
        nodeEntering.append("circle")
            .attr("class", "outer-circle")
            .attr("r", outerRadius);
        // Inner circle (click toggles activation)
        nodeEntering.append("circle")
            .attr("class", "inner-circle")
            .attr("r", innerRadius)
            .on("click", (event, d) => {
                event.stopPropagation();
                const circle = d3.select(event.currentTarget);
                circle.classed("activated", !circle.classed("activated"));
            });
        // Node id label
        nodeEntering.append("text")
            .attr("class", "node-label")
            .attr("x", 0)
            .attr("y", -10)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .text(d => d.id);

        // Cost label (below node)
        nodeEntering.append("text")
            .attr("class", "cost-label")
            .attr("x", 0)
            .attr("y", outerRadius + 12)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("pointer-events", "none")
            .text(d => d.cost !== undefined ? `Cost: ${d.cost}` : "");
        // Heuristic label (below cost)
        nodeEntering.append("text")
            .attr("class", "heuristic-label")
            .attr("x", 0)
            .attr("y", 10)
            .attr("text-anchor", "middle")
            .style("pointer-events", "none")
            .text(d => d.h !== undefined ? `h: ${d.h}` : "");

        nodeSelection = nodeEntering.merge(nodeSelection);
        updatePositions();
        updateStartNodeSelect();
        updateGoalNodeSelect();
    }

    // Update positions for graph elements
    function updatePositions() {
        linkSelection
            .attr("x1", n => getNode(n.source).x)
            .attr("y1", n => getNode(n.source).y)
            .attr("x2", n => getNode(n.target).x)
            .attr("y2", n => getNode(n.target).y);

        // Midpoint for link labels
        linkLabelSelection
            .attr("x", d => {
                let source = getNode(d.source), target = getNode(d.target);
                return (source.x + target.x) / 2;
            })
            .attr("y", d => {
                let source = getNode(d.source), target = getNode(d.target);
                return (source.y + target.y) / 2;
            });

        nodeSelection.attr("transform", d => `translate(${d.x}, ${d.y})`);
    }

    // Build adjacency list
    function buildAdjacency() {
        adjacency = {};
        nodes.forEach(n => adjacency[n.id] = []);
        links.forEach(link => {
            const s = normalizeEndpoint(link.source);
            const t = normalizeEndpoint(link.target);
            adjacency[s].push(t);
            adjacency[t].push(s);
        });
    }

    // Helper: Get a specific node
    function getNode(idOrObj) {
        if (typeof idOrObj === "object") return idOrObj;
        return nodes.find(n => n.id === idOrObj);
    }

    function constrainNode(d) {
        d.x = Math.max(outerRadius, Math.min(width - outerRadius, d.x));
        d.y = Math.max(outerRadius, Math.min(height - outerRadius, d.y));
    }

    function updateContainerSize() {
        const rect = svgEl.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
    }



    // ───────── Search‑Tree Functions ─────────
    function buildTreeData(parents, startId) {
        const children = {};
        Object.entries(parents).forEach(([child, parent]) => {
            (children[parent] ||= []).push(+child);
        });
        function recurse(id) {
            return { id, children: (children[id] || []).map(recurse) };
        }
        return recurse(startId);
    }

    // ───────── Global Force Simulation ─────────
    const simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(100).strength(0.7))
        .force("charge", d3.forceManyBody().strength(-200))
        .force("collide", d3.forceCollide(outerRadius + 1))    // Prevent overlaps & enforce boundary
        .force("center", d3.forceCenter(width/2, height/2))
        .on("tick", () => {
            updateContainerSize();
            nodes.forEach(constrainNode);
            updatePositions();
        });



    // ───────── Graph Generation Function ─────────
    function generateRandomGraph(numNodes) {
        wipeCosts();
        wipeLinksAndWeights();

        // If no nodes, just clear
        if (numNodes < 1) {
            nodes = [];
            links = [];
            simulation.nodes(nodes);
            simulation.force("link").links(links);
            drawGraph();
            simulation.alpha(0).stop();
            return;
        }

        // Decide if we include weights on edges
        const includeWeights = document.getElementById("includeWeights").checked;

        // 1) Create random-positioned nodes
        nodes = Array.from({ length: numNodes }, (_, i) => ({
            id: i,
            x: Math.random() * (width - 2 * outerRadius) + outerRadius,
            y: Math.random() * (height - 2 * outerRadius) + outerRadius
        }));

        // Shuffle node IDs so spanning tree is random
        let nodeIds = nodes.map(n => n.id);
        for (let i = nodeIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
        }

        // 2) Build a spanning tree
        let linksTemp = [];
        for (let i = 1; i < nodeIds.length; i++) {
            const src = nodeIds[Math.floor(Math.random() * i)];
            const tgt = nodeIds[i];
            linksTemp.push({
                source: src,
                target: tgt,
                weight: includeWeights
                    ? Math.floor(Math.random() * 20) + 1
                    : undefined
            });
        }

        // Track each node's degree
        let degreeCount = new Array(numNodes).fill(0);
        linksTemp.forEach(({ source, target }) => {
            degreeCount[source]++;
            degreeCount[target]++;
        });

        // 3) Build a list of all remaining edges not already in the spanning tree
        let candidateEdges = [];
        for (let i = 0; i < numNodes; i++) {
            for (let j = i + 1; j < numNodes; j++) {
                // Skip if it's already in linksTemp
                if (linksTemp.some(l => {
                    const s = normalizeEndpoint(l.source);
                    const t = normalizeEndpoint(l.target);
                    return (s === i && t === j) || (s === j && t === i);
                })) {
                    continue;
                }
                candidateEdges.push({ source: i, target: j });
            }
        }

        // Shuffle candidate edges for randomness
        for (let i = candidateEdges.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidateEdges[i], candidateEdges[j]] = [candidateEdges[j], candidateEdges[i]];
        }

        // Let’s define the fraction of nodes allowed to have degree 3
        // e.g., no more than 20% of nodes
        const maxDegree3Fraction = 0.2;

        // 4) Try adding more edges. Stop if either endpoint is degree 3,
        //    or if adding the edge would push fraction of degree-3 nodes above 20%.
        candidateEdges.forEach(edge => {
            const { source, target } = edge;
            if (degreeCount[source] < 3 && degreeCount[target] < 3) {
                // Check how many are currently at degree 3
                let countDeg3 = degreeCount.filter(d => d === 3).length;
                let fractionDeg3 = countDeg3 / numNodes;

                // If neither node is at 3, check if *after* adding them to 3
                // we still are within the fraction limit.
                // In the worst case, both might jump from 2 -> 3,
                // so let's see if that would push us over the threshold.
                let inc = 0;
                if (degreeCount[source] === 2) inc++;
                if (degreeCount[target] === 2) inc++;
                // If the fraction with deg3 after potential increment would exceed
                // maxDegree3Fraction, skip adding.
                if ((countDeg3 + inc) / numNodes > maxDegree3Fraction) {
                    return; // skip
                }

                // Otherwise, add this edge
                linksTemp.push({
                    source,
                    target,
                    weight: includeWeights
                        ? Math.floor(Math.random() * 20) + 1
                        : undefined
                });
                degreeCount[source]++;
                degreeCount[target]++;
            }
        });

        // Done. Now we have a spanning tree plus some random edges,
        // with max deg <= 3, and limited fraction of deg=3 nodes
        links = linksTemp;
        nextId = numNodes;

        // Update adjacency & force simulation
        buildAdjacency();
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(1).restart();

        drawGraph();
    }


    // ───────── Search‑Tree Helpers ─────────
    function clearSearchTree() {
        d3.select("#searchTreePanelSvg").selectAll("*").remove();
        document.getElementById("nodesExpanded").textContent = 0;
        document.getElementById("nodesDiscovered").textContent = 0;
        document.getElementById("currentDepth").textContent = 0;
        document.getElementById("stepsToGoal").textContent = "N/A";
        document.getElementById("finalCost").textContent = "N/A";
    }

    function drawSearchTree(snapshot) {
        const svg = d3.select("#searchTreePanelSvg");
        svg.selectAll("*").remove();
        if (!snapshot) return;

        const svgEl = document.getElementById("searchTreePanelSvg");
        const w = svgEl.clientWidth;
        const h = svgEl.clientHeight;
        if (w === 0 || h === 0) return;

        const startId = +document.getElementById("startNodeSelect").value;

        // 1) Build the hierarchy
        const root = d3.hierarchy(buildTreeData(snapshot.parents, startId));

        // 2) Copy discoveryIndex from snapshot to each node in the hierarchy
        root.each(d => {
            const snapNode = snapshot.nodes.find(n => n.id === d.data.id);
            d.data.discoveryIndex = snapNode?.discoveryIndex ?? Infinity;
        });

        // 3) Sort children by their discoveryIndex so that
        //    siblings appear left->right in the order discovered
        root.sort((a, b) => a.data.discoveryIndex - b.data.discoveryIndex);

        // 4) Run the tree layout (top to bottom)
        d3.tree()
            .size([w - 2 * outerRadius, h - 2 * outerRadius])(root);

        // Helper functions for bounding x/y to the panel
        const cx = d => Math.max(outerRadius, Math.min(w - outerRadius, d.x + outerRadius));
        const cy = d => Math.max(outerRadius, Math.min(h - outerRadius, d.y + outerRadius));

        // ───────── Draw links ─────────
        svg.selectAll(".link")
            .data(root.links())
            .enter().append("line")
            .attr("class", "link")
            .attr("x1", d => cx(d.source))
            .attr("y1", d => cy(d.source))
            .attr("x2", d => cx(d.target))
            .attr("y2", d => cy(d.target))
            .classed("path-highlight-link", d =>
                snapshot.path?.includes(d.source.data.id) &&
                snapshot.path.includes(d.target.data.id)
            );

        // ───────── Draw nodes ─────────
        const nodeG = svg.selectAll(".node-group")
            .data(root.descendants())
            .enter().append("g")
            .attr("class", "node-group")
            .classed("highlighted", d => snapshot.highlightedNodes.includes(d.data.id))
            .classed("goal-highlight", d => snapshot.goal && d.data.id === +snapshot.goal)
            .classed("path-highlight", d => snapshot.path?.includes(d.data.id))
            .classed("current-highlight", d => snapshot.currentNode === d.data.id)
            .attr("transform", d => `translate(${cx(d)},${cy(d)})`);

        // Outer circle
        nodeG.append("circle")
            .attr("class", "outer-circle")
            .attr("r", outerRadius);

        // Inner circle
        nodeG.append("circle")
            .attr("class", "inner-circle")
            .attr("r", innerRadius);

        // Node label (ID)
        nodeG.append("text")
            .attr("class", "node-label")
            .attr("x", 0)
            .attr("y", -4)
            .attr("text-anchor", "middle")
            .text(d => d.data.id);

        // Cost label
        nodeG.append("text")
            .attr("class", "cost-label")
            .attr("x", -outerRadius)
            .attr("y", outerRadius + 12)
            .attr("text-anchor", "start")
            .attr("dominant-baseline", "middle")
            .style("font-weight", "bold")
            .style("pointer-events", "none")
            .text(d => {
                const snapNode = snapshot.nodes.find(n => n.id === d.data.id);
                return snapNode?.cost !== undefined ? `C: ${snapNode.cost}` : "";
            });

        // Heuristic label
        nodeG.append("text")
            .attr("class", "heuristic-label")
            .attr("x", 0)
            .attr("y", 10)
            .attr("text-anchor", "middle")
            .text(d => {
                const snapNode = snapshot.nodes.find(n => n.id === d.data.id);
                return snapNode?.h !== undefined ? `H: ${snapNode.h}` : "";
            });

        // ───────── Link weight labels ─────────
        svg.selectAll(".link-weight-label")
            .data(root.links())
            .enter()
            .append("text")
            .attr("class", "link-weight-label")
            .attr("x", d => (d.source.x + d.target.x) / 2 + outerRadius)
            .attr("y", d => (d.source.y + d.target.y) / 2 + outerRadius)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("pointer-events", "none")
            .text(d => {
                const parent = d.source.data.id;
                const child = d.target.data.id;
                const link = snapshot.links.find(l =>
                    (normalizeEndpoint(l.source) === parent &&
                        normalizeEndpoint(l.target) === child) ||
                    (normalizeEndpoint(l.source) === child &&
                        normalizeEndpoint(l.target) === parent)
                );
                return link?.weight !== undefined ? link.weight : "";
            });

        // Show/hide link weights based on toggle
        const showWeights = document.getElementById("toggleWeightsSwitch").checked;
        d3.selectAll("#searchTreePanelSvg .link-weight-label")
            .style("display", showWeights ? "block" : "none");

        // Finally, update stats (like expanded/discovered counts)
        updateSearchTreeStats(snapshot);
    }


    const treeTabBtn = document.getElementById("tree-tab");
    if (treeTabBtn) {
        treeTabBtn.addEventListener('shown.bs.tab', () => {
            if (pendingTreeSnapshot) drawSearchTree(pendingTreeSnapshot);
        });
    }

    // ───────── Cost Label & Logging Helpers ─────────
    function updateCostLabel(nodeId, cost) {
        const node = nodes.find(n => n.id === nodeId);
        if (node) { node.cost = cost; }
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .select(".cost-label")
            .text(cost !== undefined ? `Cost: ${cost}` : "");
    }

    function setNodeCost(nodeId, cost) {
        const node = nodes.find(n => n.id === nodeId);
        if (node) node.cost = cost;
    }

    function displayNodeCost(nodeId, cost) {
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .select(".cost-label")
            .text(cost !== undefined ? `Cost: ${cost}` : "");
    }

    function captureState(currentMessage, expanded, currentNode) {
        const highlightedNodes = [];
        d3.selectAll(".node-group.highlighted").each(function(d) {
            highlightedNodes.push(d.id);
        });
        const goalNodeSelect = document.getElementById("goalNodeSelect");
        const currentGoal = goalNodeSelect ? goalNodeSelect.value : null;
        return {
            nodes: JSON.parse(JSON.stringify(nodes)),
            links: JSON.parse(JSON.stringify(links)),
            adjacency: JSON.parse(JSON.stringify(adjacency)),
            parents: JSON.parse(JSON.stringify(currentParents)),
            highlightedNodes: highlightedNodes,
            goal: currentGoal,
            path: currentPath,
            currentStep: currentMessage,
            expanded: [...expanded],
            currentNode: currentNode
        };
    }

    function logStep(msg, snapshot) {
        const newStep = { message: msg, snapshot: snapshot };
        appendStepDisplay(newStep);
    }

    function appendStepDisplay(step) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.textContent = step.message;
        button.classList.add("step-button");
        if (step.snapshot) {
            button.addEventListener("click", () => {
                stopAlgorithm();
                loadSnapshot(step.snapshot);
                currentStepIndex = Array.from(stepsList.children).indexOf(li);
            });
        } else {
            button.disabled = true;
        }
        li.appendChild(button);
        stepsList.appendChild(li);
    }

    function clearSteps() {
        historySteps = [];
        currentStepIndex = -1;
        stepsList.innerHTML = "";
    }

    function scheduleTimeout(fn, ms) {
        const id = setTimeout(fn, ms);
        allTimeouts.push(id);
        return id;
    }

    let delay = 0;
    function delayedLog(message, expanded) {
        const currentNode = expanded[expanded.length - 1];
        const snapshot = captureState(message, expanded, currentNode);
        const toastBody = currentStepToastEl.querySelector('.toast-body');
        scheduleTimeout(() => {
            logStep(message, snapshot);
            drawSearchTree(snapshot);
            toastBody.textContent = message;
            currentStepToast.show();
            historySteps.push({ message, snapshot });
            currentStepIndex = historySteps.length - 1;
        }, delay);
        delay += stepDelay;
    }

    function stopAlgorithm() {
        allTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        allTimeouts = [];
        delay = 0;
        wipeCosts();
        clearHighlights();
        clearSearchTree();
        currentStepToast.hide();
        currentPath = null;
        if (isAlgorithmRunning) logStep("Algorithm Stopped.");
        isAlgorithmRunning = false;
    }

    let pendingTreeSnapshot = null;

    function loadSnapshot(snapshot) {
        stopAlgorithm();
        wipeCosts();
        clearHighlights();
        snapshot.nodes.forEach(snapNode => {
            const node = nodes.find(n => n.id === snapNode.id);
            if (node) {
                node.cost = snapNode.cost;
                updateCostLabel(node.id, snapNode.cost);
                if (snapshot.highlightedNodes.includes(node.id)) highlightNode(node.id);
                if (snapshot.goal && +snapshot.goal === node.id) highlightGoal(node.id);
            }
        });
        if (snapshot.path) {
            highlightPath(snapshot.path);
        }
        if (snapshot.currentStep) {
            const toastBody = currentStepToastEl.querySelector('.toast-body');
            toastBody.textContent = snapshot.currentStep;
            currentStepToast.show();
        }
        drawSearchTree(snapshot);
    }

    // ───────── Highlight Helpers ─────────
    function highlightNode(nodeId) {
        d3.selectAll(".node-group").classed("current-highlight", false);
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("highlighted", true)
            .classed("current-highlight", true);
    }

    function clearHighlights() {
        d3.selectAll(".node-group")
            .classed("highlighted", false)
            .classed("path-highlight", false);
        d3.selectAll(".link")
            .classed("path-highlight-link", false);
    }

    function highlightPath(path) {
        if (!path || path.length === 0) return;
        path.forEach(nodeId => {
            d3.selectAll(".node-group")
                .filter(d => d.id === nodeId)
                .classed("path-highlight", true);
        });
        for (let i = 0; i < path.length - 1; i++) {
            d3.selectAll(".link")
                .filter(link => {
                    let src = normalizeEndpoint(link.source);
                    let tgt = normalizeEndpoint(link.target);
                    return (src === path[i] && tgt === path[i + 1]) || (src === path[i + 1] && tgt === path[i]);
                })
                .classed("path-highlight-link", true);
        }
    }

    function clearGoal() {
        d3.selectAll(".node-group").classed("goal-highlight", false);
    }

    function highlightGoal(nodeId) {
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("goal-highlight", true);
    }

    function clearCurrent() {
        d3.selectAll(".node-group").classed("current-highlight", false);
    }

    function highlightCurrent(nodeId) {
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("current-highlight", true);
    }

    // ───────── Add and Delete Node Helpers ─────────
    function addNode(parentIds) {
        const newNode = {
            id: nextId,
            x: Math.random() * (width - 2 * outerRadius) + outerRadius,
            y: Math.random() * (height - 2 * outerRadius) + outerRadius
        };
        nodes.push(newNode);
        parentIds.forEach(pid => {
            links.push({ source: pid, target: newNode.id, weight: undefined });
        });
        nextId++;
        buildAdjacency();

        // re-assign nodes and links to the force simulation
        simulation.nodes(nodes);
        simulation.force("link").links(links);

// nudge the simulation a bit to “wake it up”
        simulation.alpha(1).restart();

        drawGraph();
        updateGoalNodeSelect();
    }
    function deleteNode(nodeId) {
        // Remove the node and its links
        nodes = nodes.filter(n => n.id !== nodeId);
        links = links.filter(l => {
            const s = normalizeEndpoint(l.source);
            const t = normalizeEndpoint(l.target);
            return s !== nodeId && t !== nodeId;
        });

        // Rebuild adjacency
        buildAdjacency();

        // Update and restart the force simulation with the new arrays
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(1).restart();

        // Finally, redraw
        drawGraph();
    }

    // ───────── Update Select Elements ─────────
    const startNodeSelect = document.getElementById("startNodeSelect");
    const node1Select = document.getElementById("node1Select");
    const node2Select = document.getElementById("node2Select");
    function updateStartNodeSelect() {
        startNodeSelect.innerHTML = "";
        node1Select.innerHTML = "";
        node2Select.innerHTML = "";
        nodes.forEach(n => {
            const optStart = document.createElement("option");
            optStart.value = n.id;
            optStart.textContent = n.id;
            startNodeSelect.appendChild(optStart);

            const opt1 = document.createElement("option");
            opt1.value = n.id;
            opt1.textContent = n.id;
            node1Select.appendChild(opt1);

            const opt2 = document.createElement("option");
            opt2.value = n.id;
            opt2.textContent = n.id;
            node2Select.appendChild(opt2);
        });
    }

    function updateGoalNodeSelect() {
        const goalNodeSelect = document.getElementById("goalNodeSelect");
        const previous = goalNodeSelect.value;
        goalNodeSelect.innerHTML = "";
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "None";
        goalNodeSelect.appendChild(defaultOption);
        nodes.forEach(n => {
            const opt = document.createElement("option");
            opt.value = n.id;
            opt.textContent = n.id;
            if (String(n.id) === previous) opt.selected = true;
            goalNodeSelect.appendChild(opt);
        });
    }

    // ───────── Algorithms (BFS, DFS, UCS, A*) ─────────
    function bfs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        hideLinkWeights();
        isAlgorithmRunning = true;
        currentPath = null;

        // 1) Reset discovery indices and keep a discovered counter
        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;

        const visited = new Set();
        const queue = [startId];
        const expanded = [];
        visited.add(startId);
        const parents = {};
        currentParents = parents;

        function visitNext() {
            if (!isAlgorithmRunning) return;
            delay = 0;
            if (queue.length === 0) {
                delayedLog(`BFS: Finished without reaching a goal`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            const current = queue.shift();
            expanded.push(current);
            highlightNode(current);

            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(`BFS: Goal Node ${goalId} found! \nPath: ${currentPath.join(" -> ")}`, expanded);
                isAlgorithmRunning = false;
                return;
            }

            if (current === startId) {
                delayedLog(`BFS: Root Node ${startId}`, expanded);
                // Mark the start node's discoveryIndex if it isn't set:
                const startNodeObj = getNode(startId);
                if (startNodeObj && startNodeObj.discoveryIndex === undefined) {
                    startNodeObj.discoveryIndex = discoveredCount++;
                }
            } else {
                delayedLog(`BFS: Moving to Node ${current}`, expanded);
            }

            // 2) For each neighbor, if it isn't visited, record discovery index
            adjacency[current]?.forEach(nbr => {
                if (!visited.has(nbr)) {
                    visited.add(nbr);
                    queue.push(nbr);

                    if (!(nbr in parents)) {
                        parents[nbr] = current;
                    }

                    // Set the node's discoveryIndex if it's not set yet
                    const nbrNodeObj = getNode(nbr);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }

                    delayedLog(`BFS: Discovered Node ${nbr}. Adding to queue.`, expanded);
                }
            });

            delayedLog(`BFS: Queue: [${queue.join(", ")}] | Discovered: [${[...visited].join(", ")}]`, expanded);
            scheduleTimeout(visitNext, delay);
        }
        visitNext();
    }


    function dfs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        hideLinkWeights();
        isAlgorithmRunning = true;
        currentPath = null;

        // 1) Reset discovery indices on all nodes, and keep a discovered counter
        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;

        const visited = new Set();
        const stack = [startId];
        const expanded = [];
        visited.add(startId);

        const parents = {};
        currentParents = parents;

        function visitNext() {
            if (!isAlgorithmRunning) return;
            delay = 0;

            if (stack.length === 0) {
                delayedLog(`DFS: Finished without reaching a goal`, expanded);
                isAlgorithmRunning = false;
                return;
            }

            const current = stack.pop();
            expanded.push(current);

            // If the start node has no discovery index yet, set it
            if (current === startId) {
                const startNodeObj = getNode(startId);
                if (startNodeObj && startNodeObj.discoveryIndex === undefined) {
                    startNodeObj.discoveryIndex = discoveredCount++;
                }
            }

            highlightNode(current);

            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(
                    `DFS: Goal Node ${goalId} found! \nPath: ${currentPath.join(" -> ")}`,
                    expanded
                );
                isAlgorithmRunning = false;
                return;
            }

            if (current === startId) {
                delayedLog(`DFS: Root Node ${startId}`, expanded);
            } else {
                delayedLog(`DFS: Visiting Node ${current}`, expanded);
            }

            // 2) For each neighbor, if we haven't visited yet, mark discoveryIndex
            const neighbors = adjacency[current] || [];
            for (let i = neighbors.length - 1; i >= 0; i--) {
                const nbr = neighbors[i];
                if (!visited.has(nbr)) {
                    visited.add(nbr);
                    stack.push(nbr);

                    // Record parent if not known
                    if (!(nbr in parents)) {
                        parents[nbr] = current;
                    }

                    // Assign discoveryIndex to newly discovered node
                    const nbrNodeObj = getNode(nbr);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }

                    delayedLog(`DFS: Discovered Node ${nbr}. Adding to stack.`, expanded);
                }
            }

            delayedLog(
                `DFS: Stack: [${stack.join(", ")}] | Visited: [${[...visited].join(", ")}]`,
                expanded
            );
            scheduleTimeout(visitNext, delay);
        }

        visitNext();
    }

    function ucs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        showLinkWeights();
        isAlgorithmRunning = true;
        currentPath = null;

        // Ensure all links have weights
        if (links.some(link => link.weight === undefined)) {
            alert("Error: Graph must be weighted to run Uniform Cost Search (UCS).");
            return;
        }

        // 1) Reset discovery indices & keep a counter
        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;

        // Mark the start node's discoveryIndex right away
        const startNodeObj = getNode(startId);
        if (startNodeObj && startNodeObj.discoveryIndex === undefined) {
            startNodeObj.discoveryIndex = discoveredCount++;
        }

        let frontier = [{ node: startId, cost: 0 }];
        let explored = new Set();
        let parents = {};
        currentParents = parents;
        let costs = {};
        costs[startId] = 0;
        const expanded = [];

        function visitNext() {
            if (!isAlgorithmRunning) return;
            delay = 0;

            if (frontier.length === 0) {
                delayedLog("UCS: No path found. Frontier empty.", expanded);
                isAlgorithmRunning = false;
                return;
            }

            frontier.sort((a, b) => a.cost - b.cost);
            let currentObj = frontier.shift();
            let current = currentObj.node;
            let currentCost = currentObj.cost;

            if (currentCost > costs[current]) {
                delayedLog(
                    `UCS: Skipping node [${current}] with cost ${currentCost} ` +
                    `(better cost is ${costs[current]}).`,
                    expanded
                );
                scheduleTimeout(visitNext, delay);
                return;
            }

            explored.add(current);
            highlightNode(current);
            setNodeCost(current, currentCost);
            expanded.push(current);

            scheduleTimeout(() => displayNodeCost(current, currentCost), delay - 1);
            delayedLog(`UCS: Expanding node [${current}] with cost ${currentCost}.`, expanded);

            // Goal check
            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(
                    `UCS: Goal node [${goalId}] reached! Path: ${currentPath.join(" -> ")}, ` +
                    `Total cost: ${currentCost}.`,
                    expanded
                );
                isAlgorithmRunning = false;
                return;
            }

            // Expand neighbors
            (adjacency[current] || []).forEach(neighbor => {
                let link = links.find(l => {
                    const s = normalizeEndpoint(l.source);
                    const t = normalizeEndpoint(l.target);
                    return (
                        (s === current && t === neighbor) ||
                        (t === current && s === neighbor)
                    );
                });
                if (!link) return;

                let newCost = currentCost + link.weight;
                if (costs[neighbor] === undefined || newCost < costs[neighbor]) {
                    let oldCost = costs[neighbor] !== undefined ? costs[neighbor] : "none";
                    costs[neighbor] = newCost;
                    parents[neighbor] = current;

                    // 2) Assign discoveryIndex if this neighbor hasn't been discovered before
                    const nbrNodeObj = getNode(neighbor);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }

                    frontier.push({ node: neighbor, cost: newCost });
                    setNodeCost(neighbor, newCost);

                    scheduleTimeout(() => displayNodeCost(neighbor, newCost), delay - 1);
                    delayedLog(
                        `UCS: Found node [${neighbor}], Updating cost from ${oldCost} to ${newCost}.`,
                        expanded
                    );

                    if (explored.has(neighbor)) {
                        delayedLog(`UCS: Reopening node [${neighbor}] (cost improved).`, expanded);
                        explored.delete(neighbor);
                    }
                }
            });

            scheduleTimeout(visitNext, delay);
        }

        visitNext();
    }


    function aStar(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        showLinkWeights();
        isAlgorithmRunning = true;
        currentPath = null;

        // 1) Reset discovery indices & keep a counter
        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;

        // Mark the start node's discoveryIndex
        const startNodeObj = getNode(startId);
        if (startNodeObj && startNodeObj.discoveryIndex === undefined) {
            startNodeObj.discoveryIndex = discoveredCount++;
        }

        const frontier = [{ node: startId, g: 0 }];
        const costs = { [startId]: 0 };
        const parents = {};
        currentParents = parents;
        const expanded = new Set();

        function visitNext() {
            if (!isAlgorithmRunning) return;
            delay = 0;

            if (frontier.length === 0) {
                delayedLog("A*: No path found.", [...expanded]);
                isAlgorithmRunning = false;
                return;
            }

            // Sort by f = g + h
            frontier.sort(
                (a, b) =>
                    (a.g + getHeuristic(a.node)) - (b.g + getHeuristic(b.node))
            );

            const { node: current, g: currentG } = frontier.shift();

            // If the cost in frontier is worse than our best known cost, skip
            if (currentG > costs[current]) {
                scheduleTimeout(visitNext, delay);
                return;
            }

            highlightNode(current);
            setNodeCost(current, currentG);
            expanded.add(current);

            delayedLog(
                `A*: Expanding node ${current} (f=${(currentG + getHeuristic(current)).toFixed(2)})`,
                [...expanded]
            );

            // Goal check
            if (current === goalId) {
                const path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(path);
                delayedLog(`A*: Goal reached! Path: ${path.join(" -> ")}`, [...expanded]);
                isAlgorithmRunning = false;
                return;
            }

            // For each neighbor
            adjacency[current]?.forEach(neighbor => {
                const link = links.find(l => {
                    const s = normalizeEndpoint(l.source);
                    const t = normalizeEndpoint(l.target);
                    return (
                        (s === current && t === neighbor) ||
                        (t === current && s === neighbor)
                    );
                });
                if (!link) return;

                const tentativeG = currentG + link.weight;
                if (costs[neighbor] === undefined || tentativeG < costs[neighbor]) {
                    costs[neighbor] = tentativeG;
                    parents[neighbor] = current;

                    // 2) Assign discoveryIndex if we haven't before
                    const nbrNodeObj = getNode(neighbor);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }

                    frontier.push({ node: neighbor, g: tentativeG });
                    scheduleTimeout(() => displayNodeCost(neighbor, tentativeG), delay - 1);

                    delayedLog(
                        `A*: Discovered ${neighbor}, g=${tentativeG.toFixed(2)}, ` +
                        `f=${(tentativeG + getHeuristic(neighbor)).toFixed(2)}`,
                        [...expanded]
                    );
                }
            });

            scheduleTimeout(visitNext, delay);
        }

        visitNext();
    }


    function getHeuristic(id) {
        const node = nodes.find(n => n.id === id);
        return node?.h ?? 0;
    }

    // ───────── Event Listeners ─────────
    const generateForm = document.getElementById("generateGraphForm");
    const nodeCountInput = document.getElementById("nodeCountInput");
    generateForm.addEventListener("submit", (e) => {
        stopAlgorithm();
        clearSteps();
        clearGoal();
        e.preventDefault();
        let count = parseInt(nodeCountInput.value, 10);
        if (count < 1) return;
        generateRandomGraph(count);
        nodeCountInput.value = "";
    });

    document.getElementById("tutorialBtn").addEventListener("click", function() {
        introJs().setOptions({
            steps: [
                {
                    element: document.querySelector("#generateGraphForm"),
                    intro: "Use this form to generate a new graph by specifying the number of nodes and weight options.",
                    position: "right"
                },
                {
                    element: document.querySelector("#weightDiv"),
                    intro: "Toggle this switch to show or hide edge weights on the graph.",
                    position: "right"
                },
                {
                    element: document.querySelector("#AddNodeDiv"),
                    intro: "Here is where you can add or delete a node. Make sure to activate a parent node by clicking its inner circle first.",
                    position: "right"
                },
                {
                    element: document.querySelector("#updateLinkForm"),
                    intro: "Update the link weight between two nodes using these controls.",
                    position: "top"
                },
                {
                    element: document.querySelector("#selectGoalDiv"),
                    intro: "Select your goal node from the dropdown.",
                    position: "top"
                },
                {
                    element: document.querySelector("#selectStartDiv"),
                    intro: "Choose your starting node for algorithm traversal here.",
                    position: "top"
                },
                {
                    element: document.querySelector("#resetDiv"),
                    intro: "Click this button to reset the graph and clear the algorithm history.",
                    position: "top"
                },
                {
                    element: document.querySelector("#toggleSidebar"),
                    intro: "Click here to hide or show the sidebar.",
                    position: "left"
                },
                {
                    element: document.querySelector("#algorithmDropdown"),
                    intro: "Select an algorithm (BFS, DFS, UCS, etc.) from this dropdown.",
                    position: "bottom"
                },
                {
                    element: document.querySelector("#runAlgorithmBtn"),
                    intro: "Click here to run the selected algorithm and see the traversal animation.",
                    position: "left"
                },
                {
                    element: document.querySelector("#backStep"),
                    intro: "Use this button to go back one step in the algorithm history.",
                    position: "top"
                },
                {
                    element: document.querySelector("#forwardStep"),
                    intro: "Use this button to move forward one step in the algorithm history.",
                    position: "top"
                },
                {
                    element: document.querySelector("#speedControls"),
                    intro: "Adjust the speed of the algorithm traversal using these radio buttons.",
                    position: "top"
                },
                {
                    element: document.querySelector(".nav-tabs"),
                    intro: "Switch between the Graph view and the History view using these tabs.",
                    position: "bottom"
                },
                {
                    element: document.querySelector("#mainGraph"),
                    intro: "This is your graph area where the generated graph is displayed. You can interact with the graph here.",
                    position: "top"
                }
            ],
            showStepNumbers: true,
            exitOnOverlayClick: true,
            exitOnEsc: true,
            nextLabel: "Next",
            prevLabel: "Back",
            doneLabel: "Finish",
            overlayOpacity: 0.5,
            tooltipClass: "customTooltip"
        }).start();
    });

    const addNodeForm = document.getElementById("addNodeForm");
    addNodeForm.addEventListener("submit", (e) => {
        stopAlgorithm();
        clearSteps();
        e.preventDefault();
        const activatedNodes = d3.selectAll(".node-group")
            .filter(function(d) {
                return d3.select(this).select(".inner-circle").classed("activated");
            })
            .data();
        const parentIds = activatedNodes.map(d => d.id);
        addNode(parentIds);
        d3.selectAll(".inner-circle").classed("activated", false);
    });

    const deleteNodeForm = document.getElementById("deleteNodeForm");
    deleteNodeForm.addEventListener("submit", (e) => {
        stopAlgorithm();
        clearSteps();
        e.preventDefault();
        const activatedNodes = d3.selectAll(".node-group")
            .filter(function(d) {
                return d3.select(this).select(".inner-circle").classed("activated");
            })
            .data();
        if (activatedNodes.length === 0) {
            alert("Please activate at least one node to delete by clicking on its inner circle.");
            return;
        }
        activatedNodes.forEach(node => { deleteNode(node.id); });
        d3.selectAll(".inner-circle").classed("activated", false);
    });

    const goalNodeSelect = document.getElementById("goalNodeSelect");
    goalNodeSelect.addEventListener("change", () => {
        clearGoal();
        const goalId = parseInt(goalNodeSelect.value, 10);
        highlightGoal(goalId);
    });

    const slider = document.getElementById("speedSlider");
    const speedValue = document.getElementById("speedValue");
    let stepDelay = parseInt(slider.value, 10);
    slider.addEventListener("input", function () {
        stepDelay = parseInt(slider.value, 10);
    });

    const clearBtn = document.getElementById("restartBtn");
    clearBtn.addEventListener("click", () => {
        stopAlgorithm();
        clearSteps();
        clearGoal();
        updateGoalNodeSelect();
        clearSearchTree();
    });

    const randomGoalBtn = document.getElementById("randomGoalBtn");
    randomGoalBtn.addEventListener("click", () => {
        clearGoal();
        if (nodes.length === 0) return;
        const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
        goalNodeSelect.value = randomNode.id;
        const goalId = parseInt(goalNodeSelect.value, 10);
        updateHeuristics(goalId);
        highlightGoal(goalId);
        alert(`Randomly selected goal: ${randomNode.id}`);
    });

    document.getElementById("toggleHeuristicSwitch").addEventListener("change", function() {
        d3.selectAll(".heuristic-label").style("display", this.checked ? "block" : "none");
    });

    document.querySelectorAll('.backStep').forEach(btn =>
        btn.addEventListener('click', () => {
            if (currentStepIndex > 0) {
                currentStepIndex--;
                loadSnapshot(historySteps[currentStepIndex].snapshot);
            } else alert("No previous step available.");
        })
    );

    document.querySelectorAll('.forwardStep').forEach(btn =>
        btn.addEventListener('click', () => {
            if (currentStepIndex < historySteps.length - 1) {
                currentStepIndex++;
                loadSnapshot(historySteps[currentStepIndex].snapshot);
            } else alert("No next step available.");
        })
    );

    document.getElementById('runAlgorithmBtn').addEventListener('click', function() {
        const startId = parseInt(document.getElementById("startNodeSelect").value, 10);
        const goalId = parseInt(document.getElementById("goalNodeSelect").value, 10);
        switch(selectedAlgorithm) {
            case 'bfs':
                bfs(startId, goalId);
                break;
            case 'dfs':
                dfs(startId, goalId);
                break;
            case 'aStar':
                aStar(startId, goalId);
                break;
            case 'ucs':
                ucs(startId, goalId);
                break;
            default:
                alert("No algorithm selected.");
        }
    });

    // Update link dropdowns
    function updateLinkSelects() {
        const node1Select = document.getElementById("node1Select");
        const node2Select = document.getElementById("node2Select");
        node1Select.innerHTML = "";
        node2Select.innerHTML = "";
        nodes.forEach(n => {
            const opt1 = document.createElement("option");
            opt1.value = n.id;
            opt1.textContent = n.id;
            node1Select.appendChild(opt1);
            const opt2 = document.createElement("option");
            opt2.value = n.id;
            opt2.textContent = n.id;
            node2Select.appendChild(opt2);
        });
    }
    updateLinkSelects();

    // Update Link Weight
    document.getElementById("updateLinkBtn").addEventListener("click", function() {
        const node1 = parseInt(document.getElementById("node1Select").value, 10);
        const node2 = parseInt(document.getElementById("node2Select").value, 10);
        if (node1 === node2) {
            alert("Cannot create a link from a node to itself.");
            return;
        }
        let newWeight = parseFloat(document.getElementById("newWeightInput").value);
        if (isNaN(newWeight)) {
            newWeight = undefined;
        }
        let linkFound = false;
        links.forEach(link => {
            const s = normalizeEndpoint(link.source);
            const t = normalizeEndpoint(link.target);
            if ((s === node1 && t === node2) || (s === node2 && t === node1)) {
                link.weight = newWeight;
                linkFound = true;
            }
        });
        if (linkFound) {
            const updatedLabels = labelGroup.selectAll(".link-label")
                .data(links.filter(l => l.weight !== undefined), link => `${normalizeEndpoint(link.source)}-${normalizeEndpoint(link.target)}`);
            updatedLabels.exit().remove();
            updatedLabels.enter()
                .append("text")
                .attr("class", "link-label")
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .style("pointer-events", "none")
                .merge(updatedLabels)
                .text(d => d.weight);
            stopAlgorithm();
            clearSteps();
            drawGraph();
            alert("Link weight updated.");
        } else {
            links.push({ source: node1, target: node2, weight: newWeight });
            buildAdjacency();
            drawGraph();
            alert("Link did not exist, so it was created.");
        }
    });

    // Remove Link
    document.getElementById("removeLinkBtn").addEventListener("click", () => {
        stopAlgorithm();
        clearSteps();
        const node1 = parseInt(document.getElementById("node1Select").value, 10);
        const node2 = parseInt(document.getElementById("node2Select").value, 10);
        const idx = links.findIndex(l => {
            const s = normalizeEndpoint(l.source);
            const t = normalizeEndpoint(l.target);
            return (s === node1 && t === node2) || (s === node2 && t === node1);
        });
        if (idx !== -1) {
            links.splice(idx, 1);
            buildAdjacency();
            drawGraph();
            alert(`Link between ${node1} and ${node2} removed.`);
        } else {
            alert("No link exists between those two nodes.");
        }
    });

    document.getElementById('getInfoBtn').addEventListener('click', () => {
        let html = "";
        switch (selectedAlgorithm) {
            case "bfs":
                html = `
        <h3>Breadth‑First Search (BFS)</h3>
        <p>BFS explores the graph one “layer” at a time, starting from the start node. It uses a queue to visit every neighbor of the current node before moving deeper. Because it visits all nodes at distance 1, then distance 2, etc., BFS always finds the shortest path in an unweighted graph.</p>
      `;
                break;
            case "dfs":
                html = `
        <h3>Depth‑First Search (DFS)</h3>
        <p>DFS dives as far as possible down one path before backtracking. It uses a stack (either explicitly or via recursion) so the most recently discovered node is visited next. DFS is memory‑efficient but does not guarantee the shortest path.</p>
      `;
                break;
            case "ucs":
                html = `
        <h3>Uniform Cost Search (UCS)</h3>
        <p>UCS works like BFS but for weighted graphs. It always expands the node with the lowest total cost from the start, using a priority queue. This guarantees it finds the least‑cost path.</p>
      `;
                break;
            case "aStar":
                html = `
        <h3>A* Search</h3>
        <p>A* combines UCS’s cost‑so‑far with an estimate (heuristic) of remaining cost to the goal. It selects the next node based on the sum of those two values, guiding the search more directly toward the goal while still guaranteeing optimality if the heuristic is admissible.</p>
      `;
                break;
            default:
                html = `<p>Please select an algorithm from the dropdown to see information.</p>`;
        }
        document.getElementById('algInfoContent').innerHTML = html;
        const modalEl = document.getElementById('algInfoModal');
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    });

    function updateWeightsVisibility(visible) {
        d3.selectAll(".link-label").style("display", visible ? "block" : "none");
        const toggleSwitch = document.getElementById("toggleWeightsSwitch");
        toggleSwitch.checked = visible;
        toggleSwitch.nextElementSibling.textContent = visible ? "Show Weights" : "Hide Weights";
    }

    document.getElementById("toggleWeightsSwitch").addEventListener("change", function() {
        updateWeightsVisibility(this.checked);
        d3.selectAll("#searchTreePanelSvg .link-weight-label")
            .style("display", this.checked ? "block" : "none");
    });

    function showLinkWeights() { updateWeightsVisibility(true); }
    function hideLinkWeights() { updateWeightsVisibility(false); }

    document.getElementById("graph-tab").addEventListener("shown.bs.tab", () => {
        width = svgEl.clientWidth;
        height = svgEl.clientHeight;
        nodes.forEach(constrainNode);
        updatePositions();
    });

    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            selectedAlgorithm = this.getAttribute('data-algorithm');
            document.getElementById('algorithmDropdown').innerText = this.innerText;
        });
    });

    const toggleButton = document.getElementById("toggleSidebar");
    const sidebar = document.getElementById("sidebar");
    const resizer = document.getElementById("sidebarResizer");

    toggleButton.addEventListener("click", () => {
        const isHidden = getComputedStyle(sidebar).display === "none";

        sidebar.style.display = isHidden ? "block" : "none";
        resizer.style.display = isHidden ? "block" : "none";
        toggleButton.textContent = isHidden ? "Hide Sidebar" : "Show Sidebar";

        // Immediately recalc size & redraw graph
        resizeGraph();
    });


    const mainContainer = document.querySelector(".main-container");
    let isResizing = false;
    resizer.addEventListener("mousedown", function (e) { isResizing = true; });
    document.addEventListener("mousemove", function (e) {
        if (!isResizing) return;
        const containerOffset = mainContainer.getBoundingClientRect().left;
        let newWidth = e.clientX - containerOffset;
        newWidth = Math.max(150, Math.min(newWidth, 600));
        sidebar.style.width = `${newWidth}px`;
        resizeGraph();
    });
    document.addEventListener("mouseup", function () { isResizing = false; });
    generateRandomGraph(5);

    const panel = document.getElementById('searchTreePanel');
    const toggleBtn = document.getElementById('toggleTreeBtn');
    toggleBtn.addEventListener('click', () => {
        const panelOpen = panel.classList.toggle('open');
        toggleBtn.textContent = panelOpen ? '◀' : '▶';
        sidebar.style.display = panelOpen ? 'none' : 'block';
        resizer.style.display = panelOpen ? 'none' : 'block';
        document.querySelector('.main-content').classList.toggle('shift', panelOpen);
        drawGraph();
        setTimeout(resizeGraph, 0);
        const currentSnapshot = historySteps[currentStepIndex]?.snapshot;
        if (currentSnapshot) {
            setTimeout(() => drawSearchTree(currentSnapshot), 0);
        }
    });

    const toggleToastSwitch = document.getElementById("toggleToastSwitch");
    const toastContainer = document.getElementById("currentStepToast").parentElement;
    toggleToastSwitch.addEventListener("change", function() {
        toastContainer.style.display = this.checked ? "block" : "none";
    });

    function resizeGraph() {
        updateContainerSize();
        svg.attr("width", width).attr("height", height);
        simulation.force("center", d3.forceCenter(width/2, height/2))
            .alpha(0.5).restart();
        nodes.forEach(constrainNode);
        updatePositions();
    }


    function updateSearchTreeStats(snapshot) {
        const statsDiv = document.getElementById("searchTreeStats");
        if (!snapshot) { statsDiv.style.display = "none"; return; }
        statsDiv.style.display = "block";
        document.getElementById("nodesExpanded").textContent = snapshot.expanded?.length ?? 0;
        const discovered = Object.keys(snapshot.parents).map(Number);
        const start = +document.getElementById("startNodeSelect").value;
        const uniqueDiscovered = new Set(discovered.concat(start));
        document.getElementById("nodesDiscovered").textContent = uniqueDiscovered.size;
        const steps = snapshot.path ? snapshot.path.length - 1 : "N/A";
        document.getElementById("stepsToGoal").textContent = steps;
        if (snapshot.path?.length) {
            const goalId = +snapshot.goal;
            const goalNode = snapshot.nodes.find(n => n.id === goalId);
            document.getElementById("finalCost").textContent = goalNode?.cost ?? "N/A";
        } else {
            document.getElementById("finalCost").textContent = "N/A";
        }
        let depth = "N/A";
        if (snapshot.currentNode != null) {
            depth = 0;
            let node = snapshot.currentNode;
            while (snapshot.parents[node] !== undefined) {
                depth++;
                node = snapshot.parents[node];
            }
        }
        document.getElementById("currentDepth").textContent = depth;
    }

    document.getElementById("goalNodeSelect").addEventListener("change", () => {
        clearGoal();
        const goalId = parseInt(goalNodeSelect.value, 10);
        if (isNaN(goalId)) return;
        highlightGoal(goalId);
        updateHeuristics(goalId);
    });

    function updateHeuristics(goalId) {
        const goal = nodes.find(n => n.id === goalId);
        if (!goal) return;
        const minWeight = Math.min(...links.map(l => l.weight ?? Infinity));
        const hops = {};
        nodes.forEach(n => hops[n.id] = Infinity);
        hops[goalId] = 0;
        const queue = [goalId];
        while (queue.length) {
            const u = queue.shift();
            adjacency[u].forEach(v => {
                if (hops[v] === Infinity) {
                    hops[v] = hops[u] + 1;
                    queue.push(v);
                }
            });
        }
        nodes.forEach(n => {
            n.h = Number.isFinite(hops[n.id]) ? hops[n.id] * minWeight : 0;
            d3.selectAll(".node-group")
                .filter(d => d.id === n.id)
                .select(".heuristic-label")
                .text(`H: ${n.h}`);
        });
        drawGraph();
    }

    window.addEventListener("resize", () => {
        const newWidth = svgEl.clientWidth;
        const newHeight = svgEl.clientHeight;
        if (newWidth !== 0 || newHeight !== 0) { resizeGraph(); }
    });

    window.addEventListener("resize", resizeGraph);


// Call once on load
    resizeGraph();

});
