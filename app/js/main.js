import * as d3 from 'd3';
import introJs from 'intro.js';

document.addEventListener("DOMContentLoaded", function() {

    // ───────── Global Variables and Initialization ─────────
    let nodes = [];
    let links = [];
    let nextId = 0;
    let adjacency = {};
    let currentPath = null;
    let currentParents = {};

    // History steps and control variables
    let historySteps = [];
    let currentStepIndex = -1;
    let allTimeouts = [];
    let isAlgorithmRunning = false;
    let delay = 0;
    let selectedAlgorithm = null;
    let stepDelay = parseInt(document.getElementById("speedSlider").value, 10);

    //flags
    let showWeightsFlag = true;
    let showHeuristicsFlag = false;
    let randomizeWeightsFlag = true;

    // Node sizes
    const outerRadius = 24;
    const innerRadius = 20;

    // Logs
    const stepsList = document.getElementById("stepsList");

    // Container dimensions and SVG setup
    const svgEl = document.getElementById("graphSvg");
    let width = svgEl.clientWidth;
    let height = svgEl.clientHeight;
    const svg = d3.select("#graphSvg")
        .attr("width", width)
        .attr("height", height);
    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const labelGroup = svg.append("g").attr("class", "labels");

    // Toast for current step
    const currentStepToastEl = document.getElementById('currentStepToast');
    const currentStepToast = new bootstrap.Toast(currentStepToastEl, {
        autohide: false,
        animation: false
    });

    // ───────── D3 Force Simulation Setup ─────────
    const simulation = d3.forceSimulation(nodes)
        .force("link", d3.forceLink(links).id(d => d.id).distance(50).strength(0.5))
        .force("charge", d3.forceManyBody().strength(-500))
        .force("collide", d3.forceCollide(outerRadius + 1))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .on("tick", () => {
            updateContainerSize();
            nodes.forEach(constrainNode);
            updatePositions();
        });

    // ───────── Graph Drawing and Utility Functions ─────────
    let linkSelection, nodeSelection, linkLabelSelection;
    function drawGraph() {
        // LINKS
        linkSelection = linkGroup.selectAll(".link")
            .data(links, link => `${link.source.id}-${link.target.id}`);
        linkSelection.exit().remove();
        linkSelection = linkSelection.enter()
            .append("line")
            .attr("class", "link")
            .merge(linkSelection);

        // Link Labels (if weight exists)
        linkLabelSelection = labelGroup.selectAll(".link-label")
            .data(links.filter(l => l.weight !== undefined), link => `${link.source.id}-${link.target.id}`);
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

        // Heuristic label (below id)
        nodeEntering.append("text")
            .attr("class", "heuristic-label")
            .attr("x", 0)
            .attr("y", 10)
            .attr("text-anchor", "middle")
            .style("pointer-events", "none")
            .text(d => d.h !== undefined ? `h: ${d.h}` : "");

        // Cost label (below node)
        nodeEntering.append("text")
            .attr("class", "cost-label")
            .attr("x", 0)
            .attr("y", outerRadius + 12)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .style("pointer-events", "none")
            .style("font-weight", "bold")
            .text(d => d.cost !== undefined ? `Cost: ${d.cost}` : "");


        nodeSelection = nodeEntering.merge(nodeSelection);
        updatePositions();
        updateStartNodeSelect();
        updateGoalNodeSelect();
    }

    // ───────── Graph Generation Function ─────────
    function generateRandomGraph(numNodes) {
        wipeCosts();
        wipeLinksAndWeights();
        if (numNodes < 1) {
            nodes = [];
            links = [];
            simulation.nodes(nodes);
            simulation.force("link").links(links);
            drawGraph();
            simulation.alpha(0).stop();
            return;
        }
        const includeWeights = document.getElementById("includeWeights").checked;
        nodes = Array.from({ length: numNodes }, (_, i) => ({
            id: i,
            x: Math.random() * (width - 2 * outerRadius) + outerRadius,
            y: Math.random() * (height - 2 * outerRadius) + outerRadius
        }));
        let nodeIds = nodes.map(n => n.id);
        for (let i = nodeIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
        }
        let linksTemp = [];
        for (let i = 1; i < nodeIds.length; i++) {
            const src = nodeIds[Math.floor(Math.random() * i)];
            const tgt = nodeIds[i];
            linksTemp.push({
                source: src,
                target: tgt,
                weight: includeWeights ? Math.floor(Math.random() * 20) + 1 : undefined
            });
        }
        let degreeCount = new Array(numNodes).fill(0);
        linksTemp.forEach(({ source, target }) => {
            degreeCount[source]++;
            degreeCount[target]++;
        });
        let candidateEdges = [];
        for (let i = 0; i < numNodes; i++) {
            for (let j = i + 1; j < numNodes; j++) {
                if (linksTemp.some(link =>
                    (link.source === i && link.target === j) ||
                    (link.source === j && link.target === i)
                )) {
                    continue;
                }
                candidateEdges.push({ source: i, target: j });
            }
        }
        for (let i = candidateEdges.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidateEdges[i], candidateEdges[j]] = [candidateEdges[j], candidateEdges[i]];
        }
        const maxDegree3Fraction = 0.2;
        candidateEdges.forEach(edge => {
            const { source, target } = edge;
            if (degreeCount[source] < 3 && degreeCount[target] < 3) {
                let countDeg3 = degreeCount.filter(d => d === 3).length;
                let fractionDeg3 = countDeg3 / numNodes;
                let inc = 0;
                if (degreeCount[source] === 2) inc++;
                if (degreeCount[target] === 2) inc++;
                if ((countDeg3 + inc) / numNodes > maxDegree3Fraction) {
                    return;
                }
                linksTemp.push({
                    source,
                    target,
                    weight: includeWeights ? Math.floor(Math.random() * 20) + 1 : undefined
                });
                degreeCount[source]++;
                degreeCount[target]++;
            }
        });
        links = linksTemp.map(l => ({
            source: nodes[l.source],
            target: nodes[l.target],
            weight: l.weight
        }));
        nextId = numNodes;
        buildAdjacency();
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(1).restart();
        drawGraph();
    }

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
            const s = link.source.id;
            const t = link.target.id;
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

    // Update container size from DOM element
    function updateContainerSize() {
        const size = svgEl.getBoundingClientRect();
        width = size.width;
        height = size.height;
    }

    function resizeGraph() {
        updateContainerSize();
        svg.attr("width", width).attr("height", height);
        simulation.force("center", d3.forceCenter(width/2, height/2))
            .alpha(0.5).restart();
        nodes.forEach(constrainNode);
        updatePositions();
    }

    // ───────── Search-Tree Functions ─────────
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

        // 3) Sort children by their discoveryIndex so that siblings appear left->right
        root.sort((a, b) => a.data.discoveryIndex - b.data.discoveryIndex);

        // 4) Run the tree layout (top to bottom)
        d3.tree().size([w - 2 * outerRadius, h - 3 * outerRadius])(root);
        const cx = d => Math.max(outerRadius, Math.min(w - outerRadius, d.x + outerRadius));
        const cy = d => Math.max(outerRadius, Math.min(h - outerRadius, d.y + outerRadius));

        // Draw links
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

        // Draw nodes
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
                return snapNode?.cost !== undefined ? `Cost: ${snapNode.cost}` : "";
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

        // Link weight labels
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
                const link = snapshot.links.find(link =>
                    (link.source.id === parent && link.target.id === child) ||
                    (link.source.id === child && link.target.id === parent)
                );
                return link?.weight !== undefined ? link.weight : "";
            });

        d3.selectAll("#searchTreePanelSvg .link-weight-label")
            .style("display", showWeightsFlag ? "block" : "none");

        d3.selectAll("#searchTreePanelSvg .heuristic-label")
            .style("display", showHeuristicsFlag ? "block" : "none");


        updateSearchTreeStats(snapshot);
    }

    let pendingTreeSnapshot = null;
    const treeTabBtn = document.getElementById("tree-tab");
    if (treeTabBtn) {
        treeTabBtn.addEventListener('shown.bs.tab', () => {
            if (pendingTreeSnapshot) {
                drawSearchTree(pendingTreeSnapshot);
            }
        });
    }

    const treeSvg = document.getElementById("searchTreePanelSvg");
    const ro = new ResizeObserver(() => scheduleTreeRedraw());
    ro.observe(treeSvg);

    let redrawHandle;
    function scheduleTreeRedraw() {
        if (redrawHandle) {
            clearTimeout(redrawHandle);
        }
        redrawHandle = setTimeout(() => {
            const snapshot = historySteps[currentStepIndex]?.snapshot;
            if (snapshot) drawSearchTree(snapshot);
        }, 200);
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

    function updateHeuristics(goalId) {
        const goal = nodes.find(node => node.id === goalId);
        if (!goal) {
            return;
        }
        const minWeight = Math.min(...links.map(link => link.weight ?? Infinity));
        const depth = {};
        nodes.forEach(node => depth[node.id] = Infinity);
        depth[goalId] = 0;
        const queue = [goalId];
        while (queue.length) {
            const u = queue.shift();
            adjacency[u].forEach(v => {
                if (depth[v] === Infinity) {
                    depth[v] = depth[u] + 1;
                    queue.push(v);
                }
            });
        }
        nodes.forEach(node => {
            node.h = Number.isFinite(depth[node.id]) ? depth[node.id] * minWeight : 0;
            d3.selectAll(".node-group")
                .filter(d => d.id === node.id)
                .select(".heuristic-label")
                .text(`H: ${node.h}`);
        });
        drawGraph();
    }

    // ───────── Reset and Clear Functions ─────────
    function wipeCosts() {
        nodes.forEach(n => { n.cost = undefined; });
        d3.selectAll(".node-group")
            .select(".cost-label")
            .text("");
    }

    function wipeLinksAndWeights() {
        links = [];
        linkGroup.selectAll(".link").remove();
        labelGroup.selectAll(".link-label").remove();
    }

    function clearSearchTree() {
        d3.select("#searchTreePanelSvg").selectAll("*").remove();
        document.getElementById("nodesExpanded").textContent = 0;
        document.getElementById("nodesDiscovered").textContent = 0;
        document.getElementById("currentDepth").textContent = 0;
        document.getElementById("stepsToGoal").textContent = "N/A";
        document.getElementById("finalCost").textContent = "N/A";
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

    // ───────── Highlighting Helpers ─────────
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
                    let s = link.source.id;
                    let t = link.target.id;
                    return (s === path[i] && t === path[i + 1]) || (s === path[i + 1] && t === path[i]);
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

    // ───────── Node Modification Functions ─────────
    function addNode(parentIds) {
        const newNode = {
            id: nextId,
            x: Math.random() * (width - 2 * outerRadius) + outerRadius,
            y: Math.random() * (height - 2 * outerRadius) + outerRadius
        };
        nodes.push(newNode);
        parentIds.forEach(pid => {
            const parentNode = getNode(pid);
            if (!parentNode || parentNode.id === newNode.id) return;
            links.push({
                source: parentNode,
                target: newNode,
                weight: randomizeWeightsFlag ? Math.floor(Math.random() * 20) + 1 : undefined
            });
        });
        nextId++;
        buildAdjacency();
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(0).stop();
        drawGraph();
        updateGoalNodeSelect();
    }

    function deleteNode(nodeId) {
        nodes = nodes.filter(n => n.id !== nodeId);
        links = links.filter(link => {
            const s = link.source.id;
            const t = link.target.id;
            return s !== nodeId && t !== nodeId;
        });
        buildAdjacency();
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(0).stop();
        drawGraph();
    }

    function getHeuristic(id) {
        const node = nodes.find(n => n.id === id);
        return node?.h ?? 0;
    }

    // ───────── Link Weight and Heuristic Visibility ─────────
    function showLinkWeights() {
        updateWeightsVisibility(true);
    }
    function hideLinkWeights() {
        updateWeightsVisibility(false);
    }
    function showHeuristics() {
        updateHeuristicVisibility(true);
    }
    function hideHeuristics() {
        updateHeuristicVisibility(false);
    }
    function updateHeuristicVisibility(show) {
        showHeuristicsFlag = show;
        d3.selectAll(".heuristic-label").style("display", show ? "block" : "none");
        d3.selectAll("#searchTreePanelSvg .heuristic-label").style("display", show ? "block" : "none");

        document.getElementById("toggleHeuristicSwitch").checked = show;
    }

    function updateWeightsVisibility(show) {
        showWeightsFlag = show;
        d3.selectAll(".link-label").style("display", show ? "block" : "none");
        d3.selectAll("#searchTreePanelSvg .link-weight-label").style("display", show ? "block" : "none");

        const toggle = document.getElementById("toggleWeightsSwitch");
        toggle.checked = show;
        toggle.nextElementSibling.textContent = show ? "Hide Weights" : "Show Weights";
    }




    // ───────── Search Algorithms ─────────

    // Breadth-First Search (BFS)
    function bfs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        hideLinkWeights();
        hideHeuristics();
        isAlgorithmRunning = true;
        currentPath = null;
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
                const startNodeObj = getNode(startId);
                if (startNodeObj && startNodeObj.discoveryIndex === undefined) {
                    startNodeObj.discoveryIndex = discoveredCount++;
                }
            } else {
                delayedLog(`BFS: Moving to Node ${current}`, expanded);
            }
            adjacency[current]?.forEach(nbr => {
                if (!visited.has(nbr)) {
                    visited.add(nbr);
                    queue.push(nbr);
                    if (!(nbr in parents)) {
                        parents[nbr] = current;
                    }
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

    // Depth-First Search (DFS)
    function dfs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        hideLinkWeights();
        hideHeuristics();
        isAlgorithmRunning = true;
        currentPath = null;
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
                delayedLog(`DFS: Goal Node ${goalId} found! \nPath: ${currentPath.join(" -> ")}`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            if (current === startId) {
                delayedLog(`DFS: Root Node ${startId}`, expanded);
            } else {
                delayedLog(`DFS: Visiting Node ${current}`, expanded);
            }
            const neighbors = adjacency[current] || [];
            for (let i = neighbors.length - 1; i >= 0; i--) {
                const nbr = neighbors[i];
                if (!visited.has(nbr)) {
                    visited.add(nbr);
                    stack.push(nbr);
                    if (!(nbr in parents)) {
                        parents[nbr] = current;
                    }
                    const nbrNodeObj = getNode(nbr);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }
                    delayedLog(`DFS: Discovered Node ${nbr}. Adding to stack.`, expanded);
                }
            }
            delayedLog(`DFS: Stack: [${stack.join(", ")}] | Visited: [${[...visited].join(", ")}]`, expanded);
            scheduleTimeout(visitNext, delay);
        }
        visitNext();
    }

    // Uniform Cost Search (UCS)
    function ucs(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        showLinkWeights();
        hideHeuristics();
        isAlgorithmRunning = true;
        currentPath = null;
        if (links.some(link => link.weight === undefined)) {
            alert("Error: Graph must be fully weighted to run Uniform Cost Search (UCS).");
            return;
        }
        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;
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
                delayedLog(`UCS: Skipping node [${current}] with cost ${currentCost} (better cost is ${costs[current]}).`, expanded);
                scheduleTimeout(visitNext, delay);
                return;
            }
            explored.add(current);
            highlightNode(current);
            setNodeCost(current, currentCost);
            expanded.push(current);
            scheduleTimeout(() => displayNodeCost(current, currentCost), delay - 1);
            delayedLog(`UCS: Expanding node [${current}] with cost ${currentCost}.`, expanded);
            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(`UCS: Goal node [${goalId}] reached! Path: ${currentPath.join(" -> ")}, Total cost: ${currentCost}.`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            (adjacency[current] || []).forEach(neighbor => {
                let link = links.find(link => {
                    const s = link.source.id;
                    const t = link.target.id;
                    return ((s === current && t === neighbor) || (t === current && s === neighbor));
                });
                if (!link) return;
                let newCost = currentCost + link.weight;
                if (costs[neighbor] === undefined || newCost < costs[neighbor]) {
                    let oldCost = costs[neighbor] !== undefined ? costs[neighbor] : "none";
                    costs[neighbor] = newCost;
                    parents[neighbor] = current;
                    const nbrNodeObj = getNode(neighbor);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }
                    frontier.push({ node: neighbor, cost: newCost });
                    setNodeCost(neighbor, newCost);
                    scheduleTimeout(() => displayNodeCost(neighbor, newCost), delay - 1);
                    delayedLog(`UCS: Found node [${neighbor}], Updating cost from ${oldCost} to ${newCost}.`, expanded);
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

    // A* Search
    function aStar(startId, goalId) {
        stopAlgorithm();
        clearSteps();
        showLinkWeights();
        showHeuristics();
        isAlgorithmRunning = true;
        currentPath = null;

        if (isNaN(goalId)) {
            alert("Please select a goal node before running A*.");
            return;
        }
        if (links.some(link => link.weight === undefined)) {
            alert("Error: Graph must be fully weighted to run AStar.");
            return;
        }

        nodes.forEach(n => {
            n.discoveryIndex = undefined;
        });
        let discoveredCount = 0;
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
            frontier.sort((a, b) => (a.g + getHeuristic(a.node)) - (b.g + getHeuristic(b.node)));
            const { node: current, g: currentG } = frontier.shift();
            if (currentG > costs[current]) {
                scheduleTimeout(visitNext, delay);
                return;
            }
            highlightNode(current);
            setNodeCost(current, currentG);
            expanded.add(current);
            delayedLog(`A*: Expanding node ${current} (f=${(currentG + getHeuristic(current)).toFixed(2)})`, [...expanded]);
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
            adjacency[current]?.forEach(neighbor => {
                const link = links.find(link => {
                    const s = link.source.id;
                    const t = link.target.id;
                    return ((s === current && t === neighbor) || (t === current && s === neighbor));
                });
                if (!link) return;
                const tentativeG = currentG + link.weight;
                if (costs[neighbor] === undefined || tentativeG < costs[neighbor]) {
                    costs[neighbor] = tentativeG;
                    parents[neighbor] = current;
                    const nbrNodeObj = getNode(neighbor);
                    if (nbrNodeObj && nbrNodeObj.discoveryIndex === undefined) {
                        nbrNodeObj.discoveryIndex = discoveredCount++;
                    }
                    frontier.push({ node: neighbor, g: tentativeG });
                    scheduleTimeout(() => displayNodeCost(neighbor, tentativeG), delay - 1);
                    delayedLog(`A*: Discovered ${neighbor}, g=${tentativeG.toFixed(2)}, f=${(tentativeG + getHeuristic(neighbor)).toFixed(2)}`, [...expanded]);
                }
            });
            scheduleTimeout(visitNext, delay);
        }
        visitNext();
    }

    // ───────── Event Listeners ─────────

    // Generate Graph Form Event
    const nodeCountInput = document.getElementById("nodeCountInput");
    document.getElementById("generateGraphForm").addEventListener("submit", (e) => {
        stopAlgorithm();
        clearSteps();
        clearGoal();
        e.preventDefault();
        let count = parseInt(nodeCountInput.value, 10);
        if (count < 1) return;
        generateRandomGraph(count);
        nodeCountInput.value = "";
    });

    // Tutorial Button Event
    document.getElementById("tutorialBtn").addEventListener("click", () => {
        introJs().setOptions({
            steps: [
                { element: "#generateGraphForm", intro: "Enter how many nodes you want and click Generate to build a new random graph.", position: "right" },
                { element: "#weightDiv", intro: "Toggle this to show or hide edge weights on the graph.", position: "right" },
                { element: "#heuristicToggleDiv", intro: "Toggle heuristics (h‑values) on each node — useful for A* search.", position: "right" },
                { element: "#AddNodeDiv", intro: "Click Add or Delete to modify nodes. Activate a parent by clicking its inner circle first.", position: "right" },
                { element: "#updateLinkForm", intro: "Use these controls to create, update, or remove an edge between two nodes.", position: "top" },
                { element: "#selectStartDiv", intro: "Choose your starting node for all searches.", position: "top" },
                { element: "#selectGoalDiv", intro: "Choose your goal node (or click Set Random Goal).", position: "top" },
                { element: "#algorithmDropdown", intro: "Pick a search algorithm (BFS, DFS, UCS, or A*).", position: "bottom" },
                { element: "#runAlgorithmBtn", intro: "Run the selected algorithm — watch the traversal animate!", position: "bottom" },
                { element: "#speedControls", intro: "Adjust how fast each step of the algorithm plays.", position: "top" },
                { element: ".backStep", intro: "Step backwards through the algorithm history.", position: "top" },
                { element: ".forwardStep", intro: "Step forwards through the algorithm history.", position: "top" },
                { element: "#toggleSidebar", intro: "Hide or show the sidebar to give more room to the graph.", position: "left" },
                { element: "#toggleTreeBtn", intro: "Open the Search Tree panel to see the traversal tree.", position: "left" },
                { element: "#mainGraph", intro: "This is the interactive graph area — drag nodes around or click them to activate.", position: "top" },
                { element: "#searchTreePanel", intro: "This is the Search Tree panel — it visualizes the traversal tree and shows stats about nodes expanded, discovered, depth, cost, etc.", position: "left" }
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

    // addNode Form Event
    document.getElementById("addNodeForm").addEventListener("submit", (e) => {
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

    document.getElementById("toggleRandomizeWeightsSwitch")
        .addEventListener("change", e => randomizeWeightsFlag = e.target.checked);


    // Sort Graph
    document.getElementById("sortGraphBtn").addEventListener("click", () => {
        simulation.alpha(1).restart();
    });

    // deleteNode Form Event
    document.getElementById("deleteNodeForm").addEventListener("submit", (e) => {
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

    // Speed Slider Event
    const slider = document.getElementById("speedSlider");
    slider.addEventListener("input", function () {
        stepDelay = parseInt(slider.value, 10);
    });

    // Reset Button Event
    document.getElementById("restartBtn").addEventListener("click", () => {
        stopAlgorithm();
        clearSteps();
        clearGoal();
        updateGoalNodeSelect();
        clearSearchTree();
    });

    // Select Goal Node Event
    const goalNodeSelect = document.getElementById("goalNodeSelect");
    goalNodeSelect.addEventListener("change", () => {
        stopAlgorithm()
        clearGoal();
        const goalId = parseInt(goalNodeSelect.value, 10);
        highlightGoal(goalId);
    });

    // Random Goal Button Event
    document.getElementById("randomGoalBtn").addEventListener("click", () => {
        stopAlgorithm()
        clearGoal();
        if (nodes.length === 0) return;
        const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
        goalNodeSelect.value = randomNode.id;
        const goalId = parseInt(goalNodeSelect.value, 10);
        updateHeuristics(goalId);
        highlightGoal(goalId);
        alert(`Randomly selected goal: ${randomNode.id}`);
    });

    document.getElementById("toggleWeightsSwitch")
        .addEventListener("change", e => updateWeightsVisibility(e.target.checked));

    document.getElementById("toggleHeuristicSwitch")
        .addEventListener("change", e => updateHeuristicVisibility(e.target.checked));

    // Navigation (History) Events
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

    // Choose Algorithm Dropdown Event
    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', function(event) {
            event.preventDefault();
            selectedAlgorithm = this.getAttribute('data-algorithm');
            document.getElementById('algorithmDropdown').innerText = this.innerText;
        });
    });

    // Run Algorithm Button Event
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
            case 'ucs':
                ucs(startId, goalId);
                break;
            case 'aStar':
                aStar(startId, goalId);
                break;
            default:
                alert("No algorithm selected.");
        }
    });

    // Update Link Weight Event
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
            const s = link.source.id;
            const t = link.target.id;
            if ((s === node1 && t === node2) || (s === node2 && t === node1)) {
                link.weight = newWeight;
                linkFound = true;
            }
        });
        if (linkFound) {
            const updatedLabels = labelGroup.selectAll(".link-label")
                .data(links.filter(l => l.weight !== undefined), link => `${link.source.id}-${link.target.id}`);
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
            links.push({ source: nodes[node1], target: nodes[node2], weight: newWeight });
            buildAdjacency();
            drawGraph();
            alert("Link did not exist, so it was created.");
        }
    });

    // Remove Link Event
    document.getElementById("removeLinkBtn").addEventListener("click", () => {
        stopAlgorithm();
        clearSteps();
        const node1 = parseInt(document.getElementById("node1Select").value, 10);
        const node2 = parseInt(document.getElementById("node2Select").value, 10);
        const idx = links.findIndex(link => {
            const s = link.source.id;
            const t = link.target.id;
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

    // Explanation Modal Event
    document.getElementById('getInfoBtn').addEventListener('click', () => {
        let html = "";
        switch (selectedAlgorithm) {
            case "bfs":
                html = `
            <h3>Breadth‑First Search (BFS)</h3>
            <p><strong>Description:</strong> 
            BFS explores the graph level by level, starting from the source node. It first visits all the neighbors of the source, then moves on to the neighbors of the neighbors, and so on. This guarantees that the first time a node is encountered, it's via the shortest possible path in terms of the number of edges. BFS is particularly useful for finding the shortest path in an unweighted graph, as it always explores all possible paths at the current depth before moving to the next level.</p>
            
            <img src="/assets/BFS.png" alt="BFS illustration" width="300">
            
            <p><strong>Example:</strong> Consider a graph with nodes 1, 2, 3, and 4:
            Graph: 0 → 1, 0 → 2, 1 → 3
            
            Starting from node 0:
            - First, BFS explores nodes 1 and 2 (since they are at the same level from 0).
            - Then it moves on to node 3, visiting 1 → 3.
            
            The order of visits would be: 0 → 1, 0 → 2, 1 → 3.
            </p>
                        `;
                break;
            case "dfs":
                html = `
                <h3>Depth‑First Search (DFS)</h3>
                <p><strong>Description:</strong> 
                DFS is a traversal algorithm that explores as far along a branch as possible before backtracking. It uses a stack (either implicitly via recursion or explicitly) to keep track of which nodes to visit next. DFS doesn't guarantee finding the shortest path, as it may explore deep branches that aren't the most efficient way to reach the goal. It can be useful for exploring all possible paths or when you need to visit all nodes.</p>
                
               <img src="/assets/DFS.png" alt="DFS illustration" width="300">
                
                <p><strong>Example:</strong> In the same graph as BFS:
                Graph: 0 → 1, 0 → 2, 1 → 3, 2 → 3
                
                If DFS starts at node 0, it may explore:
                - First, it goes from 0 → 1 → 3 (going deep along the branch).
                - After backtracking to 0, it then visits 2 → 3.
                
                The order of visits could be: 0 → 1 → 3 → 2 → 3.
                </p>
                        `;
                break;
            case "ucs":
                html = `
                <h3>Uniform Cost Search (UCS)</h3>
                <p><strong>Description:</strong> 
                UCS is similar to BFS but differs in that it takes edge costs into account. It always expands the node with the lowest total cost first. This ensures that the search explores paths with the least cumulative cost, rather than the shortest number of edges as in BFS. UCS is ideal when you want to find the least-cost path in a weighted graph.</p>
                
                <img src="/assets/UCS.png" alt="UCS illustration" width="300">
                
                <p><strong>Example:</strong> Consider a graph with the following edge costs:
                Graph: 0 → 1 (cost 1), 0 → 2 (cost 5), 1 → 3 (cost 5), 2 → 3 (cost 2)
                
                If UCS starts from node 0:
                - UCS would first explore 0 → 1 (cost 1), then move on to 0 → 2 (cost 5).
                - Next, UCS would explore 1 → 3 (cost 6 total) and 2 → 3 (cost 7 total).
                - The optimal path is 0 → 1 → 3 (cost 6) rather than 0 → 2 → 3 (cost 7).
                
                The order of visits would be: 0 → 1 → 3 → 2.
                </p>
                        `;
                break;
            case "aStar":
                html = `
                <h3>A* Search</h3>
                <p><strong>Description:</strong> 
                A* is a more advanced search algorithm that combines path cost and a heuristic estimate of the remaining distance to the goal. It evaluates nodes based on both the actual cost to reach the node and the estimated cost from the node to the goal, making it more efficient than UCS and BFS in many cases. A* is optimal and complete, meaning it will find the shortest path if one exists, as long as the heuristic is admissible (i.e., it doesn't overestimate the cost to the goal).</p>
                
                <img src="/assets/ASTAR.png" alt="ASTAR illustration" width="300">
                
                <p><strong>Example:</strong> Consider a graph with the following edges and heuristic values (straight-line distance to goal D):
                Graph: 0 → 1 (cost 1), 0 → 2 (cost 5), 1 → 3 (cost 5), 2 → 3 (cost 2)
                Heuristic: h(0) = 3, h(1) = 1, h(2) = 4, h(3) = 0
                
                Starting from node A:
                - A* first evaluates the node with the smallest sum of path cost and heuristic (0 → 1 + h(1) = 1 + 1 = 2).
                - Then it moves to 1 → 3 (cost 6 total).
                - Despite 0 → 2 being cheaper in terms of path cost, A* prefers 0 → 1 → 3 because its heuristic suggests 3 is closer via 1.
                
                The order of visits would be: 0 → 2 → 3.
                </p>
                      `;
                break;
            default:
                html = `<p>Please select an algorithm from the dropdown to see information.</p>`;
        }
        document.getElementById('algInfoContent').innerHTML = html;
        new bootstrap.Modal(document.getElementById('algInfoModal')).show();
    });

    // Sidebar Toggle and Resize Events
    const mainContainer = document.querySelector(".main-container");
    const sidebar = document.getElementById("sidebar");
    const toggleButton = document.getElementById("toggleSidebar");
    toggleButton.addEventListener("click", () => {
        sidebar.classList.toggle("sidebar--hidden");
        resizer.classList.toggle("sidebar--hidden");
        toggleButton.textContent = sidebar.classList.contains("sidebar--hidden")
            ? "Show Sidebar"
            : "Hide Sidebar";
        resizeGraph();
    });
    const resizer = document.getElementById("sidebarResizer");
    resizer.addEventListener("pointerdown", () => {
        document.addEventListener("pointermove", doResize);
        document.addEventListener("pointerup", stopResize, { once: true });
    });
    let frame;
    function doResize(event) {
        if (frame) {
            cancelAnimationFrame(frame);
        }
        frame = requestAnimationFrame(() => {
            const left = mainContainer.getBoundingClientRect().left;
            let widthPx = event.clientX - left;
            widthPx = Math.max(150, Math.min(widthPx, 600));
            sidebar.style.width = `${widthPx}px`;
            resizeGraph();
        });
    }
    function stopResize() {
        document.removeEventListener("pointermove", doResize);
    }









    // Toast Toggle Event
    const toggleToastSwitch = document.getElementById("toggleToastSwitch");
    const toastContainer = document.getElementById("currentStepToast").parentElement;
    toggleToastSwitch.addEventListener("change", function() {
        toastContainer.style.display = this.checked ? "block" : "none";
    });

    // SearchTree Panel Toggle Event
    const panel = document.getElementById('searchTreePanel');
    const toggleBtn = document.getElementById('toggleTreeBtn');
    toggleBtn.addEventListener('click', () => {
        const panelOpen = panel.classList.toggle('open');
        toggleBtn.textContent = panelOpen ? '◀' : '▶';
        if (panelOpen) {
            sidebar.classList.add('sidebar--hidden');
            resizer.classList.add('sidebar--hidden');
        } else {
            sidebar.classList.remove('sidebar--hidden');
            resizer.classList.remove('sidebar--hidden');
        }
        document.querySelector('.main-content').classList.toggle('shift', panelOpen);
        drawGraph();
        resizeGraph();
        const currentSnapshot = historySteps[currentStepIndex]?.snapshot;
        if (currentSnapshot) {
            drawSearchTree(currentSnapshot);
        }
    });

    // SearchTree Stats Update Function
    function updateSearchTreeStats(snapshot) {
        const statsDiv = document.getElementById("searchTreeStats")
        if (!snapshot) {
            statsDiv.style.display = "none"; return;
        }
        statsDiv.style.display = "block";
        const start = Number(document.getElementById("startNodeSelect").value);
        const discovered = Object.keys(snapshot.parents).map(Number);
        const uniqueDiscovered = new Set(discovered.concat(start));
        const steps = snapshot.path ? snapshot.path.length - 1 : "N/A";
        document.getElementById("nodesExpanded").textContent = String(snapshot.expanded?.length ?? 0)
        document.getElementById("nodesDiscovered").textContent = String(uniqueDiscovered.size);
        document.getElementById("stepsToGoal").textContent = steps;
        if (snapshot.path?.length > 0) {
            const goalId = Number(snapshot.goal);
            const goalNode = snapshot.nodes.find(node => node.id === goalId);
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

    // Goal Node Select Event
    document.getElementById("goalNodeSelect").addEventListener("change", () => {
        clearGoal();
        const goalId = parseInt(goalNodeSelect.value, 10);
        if (isNaN(goalId)) {
            return;
        }
        highlightGoal(goalId);
        updateHeuristics(goalId);
    });

    // Graph Tab Resize Event
    document.getElementById("graph-tab").addEventListener("shown.bs.tab", () => {
        width = svgEl.clientWidth;
        height = svgEl.clientHeight;
        nodes.forEach(constrainNode);
        updatePositions();
    });

    window.addEventListener("resize", () => {
        resizeGraph();
        drawGraph();
        scheduleTreeRedraw();
    });

    // ───────── Initialization ─────────
    function init() {
        generateRandomGraph(8);
    }
    init();

});


