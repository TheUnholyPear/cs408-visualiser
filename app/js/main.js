import * as d3 from 'd3';
import introJs from 'intro.js';

document.addEventListener("DOMContentLoaded", function() {

    let nodes = [];
    let links = [];
    let nextId = 0;
    let adjacency = {};
    let currentPath = null;
    let currentParents = {};

    let historySteps = [];
    let currentStepIndex = -1;
    let allTimeouts = [];
    let isAlgorithmRunning = false;
    let delay = 0;
    let selectedAlgorithm = null;
    let stepDelay = parseInt(document.getElementById("speedSlider").value, 10);

    let showWeightsFlag = true;
    let showHeuristicsFlag = false;
    let randomizeWeightsFlag = true;

    // Node sizes
    const outerRadius = 24;
    const innerRadius = 20;

    // Logs
    const stepsList = document.getElementById("stepsList");

    // SVG setup
    const svgEl = document.getElementById("graphSvg");
    let width = svgEl.clientWidth;
    let height = svgEl.clientHeight;
    const svg = d3.select("#graphSvg").attr("width", width).attr("height", height);
    const linkGroup = svg.append("g").attr("class", "links");
    const nodeGroup = svg.append("g").attr("class", "nodes");
    const labelGroup = svg.append("g").attr("class", "labels");

    const currentStepToastEl = document.getElementById('currentStepToast');
    const currentStepToast = new bootstrap.Toast(currentStepToastEl, {
        autohide: false,
        animation: false
    });

    // --------- D3 Force Simulation Setup ---------
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

    // --------- Graph Drawing and Utility Functions ---------
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

        // Inner circle
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

        // Heuristic label
        nodeEntering.append("text")
            .attr("class", "heuristic-label")
            .attr("x", 0)
            .attr("y", 10)
            .attr("text-anchor", "middle")
            .style("pointer-events", "none")
            .text(d => d.h !== undefined ? `h: ${d.h}` : "");

        // Cost label
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

    // --------- Graph Generation Function ---------
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

    // Get a specific node
    function getNode(idOrObj) {
        if (typeof idOrObj === "object") return idOrObj;
        return nodes.find(n => n.id === idOrObj);
    }

    function constrainNode(d) {
        d.x = Math.max(outerRadius, Math.min(width - outerRadius, d.x));
        d.y = Math.max(outerRadius, Math.min(height - outerRadius, d.y));
    }

    // Update container size
    function updateContainerSize() {
        const size = svgEl.getBoundingClientRect();
        width = size.width;
        height = size.height;
    }

    function resizeGraph() {
        updateContainerSize();
        svg.attr("width", width).attr("height", height);
        simulation.force("center", d3.forceCenter(width/2, height/2))
            .alpha(1).restart();
        nodes.forEach(constrainNode);
        updatePositions();
    }

    // --------- Search-Tree Functions ---------
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
        const root = d3.hierarchy(buildTreeData(snapshot.parents, startId));

        root.each(d => {
            const snapNode = snapshot.nodes.find(n => n.id === d.data.id);
            d.data.discoveryIndex = snapNode?.discoveryIndex ?? Infinity;
        });
        root.sort((a, b) => a.data.discoveryIndex - b.data.discoveryIndex);

        d3.tree().size([w - 2 * outerRadius, h - 3 * outerRadius])(root);
        const cx = d => Math.max(outerRadius, Math.min(w - outerRadius, d.x + outerRadius));
        const cy = d => Math.max(outerRadius, Math.min(h - outerRadius, d.y + outerRadius));

        // Links
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

        // Nodes
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

        // Node ID
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


    // --------- Cost Label & Logging Helpers ---------
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
        if (snapshot.currentNode != null) {
            highlightCurrent(snapshot.currentNode);
        }
        if (snapshot.currentStep) {
            const toastBody = currentStepToastEl.querySelector('.toast-body');
            toastBody.textContent = snapshot.currentStep;
            currentStepToast.show();
        }
        drawSearchTree(snapshot);
    }

    function maybeUpdateHeuristics() {
        const goalId = parseInt(goalNodeSelect.value, 10);
        if (!isNaN(goalId)) {
            updateHeuristics(goalId);
        }
    }

    function updateHeuristics(goalId) {
        const goal = nodes.find(node => node.id === goalId);
        if (!goal) {
            return;
        }

        if (links.some(link => link.weight === undefined)) {
            nodes.forEach(node => {
                node.h = 0;
                d3.selectAll(".node-group")
                    .filter(d => d.id === node.id)
                    .select(".heuristic-label")
                    .text(`H: ${node.h}`);
            });
            drawGraph();
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

    // --------- Reset and Clear Functions ---------
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

    // --------- Update Select Elements ---------
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

    // --------- Highlighting Helpers ---------
    function highlightCurrent(nodeId) {
        d3.selectAll(".node-group").classed("current-highlight", false);
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("current-highlight", true);
    }

    function highlightNode(nodeId) {
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("highlighted", true);
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
        const goalNodeSelect = document.getElementById("goalNodeSelect");
        if (goalNodeSelect) {
            goalNodeSelect.value = ""; // Reset dropdown
        }
    }


    function highlightGoal(nodeId) {
        d3.selectAll(".node-group")
            .filter(d => d.id === nodeId)
            .classed("goal-highlight", true);
    }

    // --------- Node Modification Functions ---------
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
        maybeUpdateHeuristics()
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(0).stop();
        drawGraph();
        updateGoalNodeSelect();
        showLinkWeights(showWeightsFlag)
    }

    function deleteNode(nodeId) {
        nodes = nodes.filter(n => n.id !== nodeId);
        links = links.filter(link => {
            const s = link.source.id;
            const t = link.target.id;
            return s !== nodeId && t !== nodeId;
        });
        buildAdjacency();
        maybeUpdateHeuristics()
        simulation.nodes(nodes);
        simulation.force("link").links(links);
        simulation.alpha(0).stop();
        drawGraph();
    }

    function getHeuristic(id) {
        const node = nodes.find(n => n.id === id);
        return node?.h ?? 0;
    }

    // --------- Link Weight and Heuristic Visibility ---------
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



    // --------- Search Algorithms ---------

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
            if (!isAlgorithmRunning) {
                return;
            }
            delay = 0;
            if (queue.length === 0) {
                delayedLog(`BFS: Finished without reaching a goal`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            const current = queue.shift();
            expanded.push(current);
            highlightNode(current);
            highlightCurrent(current);
            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(`BFS: Moving to Node ${current} \n Goal Node found! \nPath: ${currentPath.join(" -> ")}`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            if (current === startId) {
                delayedLog(`BFS: Root Node ${startId}`, expanded);
                const startNode = getNode(startId);
                if (startNode && startNode.discoveryIndex === undefined) {
                    startNode.discoveryIndex = discoveredCount++;
                }
            } else {
                delayedLog(`BFS: Moving to Node ${current}. Adding to expanded`, expanded);
            }
            adjacency[current]?.forEach(nbr => {
                if (!visited.has(nbr)) {
                    visited.add(nbr);
                    queue.push(nbr);
                    if (!(nbr in parents)) {
                        parents[nbr] = current;
                    }
                    const nbrNode = getNode(nbr);
                    if (nbrNode && nbrNode.discoveryIndex === undefined) {
                        nbrNode.discoveryIndex = discoveredCount++;
                    }
                    delayedLog(`BFS: Discovered Node ${nbr}. Adding to queue.`, expanded);
                }
            });
            delayedLog(`BFS: Queue: [${queue.join(", ")}], \nDiscovered: [${[...visited].join(", ")}], \nExpanded: [${expanded.join(", ")}]`, expanded);
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
            highlightNode(current);
            highlightCurrent(current);

            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(`DFS: Moving to Node ${current} \n Goal Node found! \nPath: ${currentPath.join(" -> ")}`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            if (current === startId) {
                delayedLog(`DFS: Root Node ${startId}`, expanded);
                const startNode = getNode(startId);
                if (startNode && startNode.discoveryIndex === undefined) {
                    startNode.discoveryIndex = discoveredCount++;
                }
            } else {
                delayedLog(`DFS: Moving to Node ${current}. Adding to expanded`, expanded);
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
                    const nbrNode = getNode(nbr);
                    if (nbrNode && nbrNode.discoveryIndex === undefined) {
                        nbrNode.discoveryIndex = discoveredCount++;
                    }
                    delayedLog(`DFS: Discovered Node ${nbr}. Adding to stack.`, expanded);
                }
            }
            delayedLog(`DFS: Stack: [${stack.join(", ")}], \nDiscovered: [${[...visited].join(", ")}], \nExpanded: [${expanded.join(", ")}]`, expanded);
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
        const startNode = getNode(startId);
        if (startNode && startNode.discoveryIndex === undefined) {
            startNode.discoveryIndex = discoveredCount++;
        }
        let frontier = [{ node: startId, cost: 0 }];
        const expanded = [];
        let parents = {};
        currentParents = parents;
        let costs = {};
        costs[startId] = 0;

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

            highlightNode(current);
            highlightCurrent(current);
            setNodeCost(current, currentCost);
            expanded.push(current);
            scheduleTimeout(() => displayNodeCost(current, currentCost), delay - 1);
            if (current === startId) {
                delayedLog(`UCS: Root Node ${startId}`, expanded);
            } else {
                delayedLog(`UCS: Expanding node [${current}] with cost ${currentCost}.`, expanded);
            }

            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) {
                    path.unshift(parents[path[0]]);
                }
                currentPath = path;
                highlightPath(currentPath);
                delayedLog(`UCS: Goal node [${goalId}] reached!\nPath: ${currentPath.join(" -> ")}\nTotal cost: ${currentCost}.`, expanded);
                isAlgorithmRunning = false;
                return;
            }
            (adjacency[current] || []).forEach(neighbor => {
                let link = links.find(link => {
                    const source = link.source.id;
                    const target = link.target.id;
                    return ((source === current && target === neighbor) || (target === current && source === neighbor));
                });
                if (!link) {
                    return;
                }
                let newCost = currentCost + link.weight;
                if (costs[neighbor] === undefined || newCost < costs[neighbor]) {
                    let oldCost = costs[neighbor] !== undefined ? costs[neighbor] : "none";
                    costs[neighbor] = newCost;
                    parents[neighbor] = current;

                    const nbrNode = getNode(neighbor);
                    if (nbrNode && nbrNode.discoveryIndex === undefined) {
                        nbrNode.discoveryIndex = discoveredCount++;
                    }
                    frontier.push({ node: neighbor, cost: newCost });
                    setNodeCost(neighbor, newCost);
                    scheduleTimeout(() => displayNodeCost(neighbor, newCost), delay - 1);

                    if (oldCost !== "none") {
                        delayedLog(`UCS: Reopening node [${neighbor}], Updating cost from ${oldCost} to ${newCost}.`, expanded);
                    } else {
                        delayedLog(`UCS: Found node [${neighbor}], Updating cost from ${oldCost} to ${newCost}.`, expanded);
                    }
                }
            });
            delayedLog(
                `UCS: Frontier: [${frontier.map(n => `${n.node}(${n.cost})`).join(", ")}], \nDiscovered: [${Object.keys(costs).join(", ")}], \nExpanded: [${expanded.join(", ")}]`, expanded);
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
            alert("Error: Graph must be fully weighted to run A*.");
            return;
        }
        nodes.forEach(n => n.discoveryIndex = undefined);
        let discoveredCount = 0;
        const startNode = getNode(startId);
        if (startNode) {
            startNode.discoveryIndex = discoveredCount++;
        }

        let frontier = [{ node: startId, cost: 0 }];
        const expanded = [];
        let parents = {};
        currentParents = parents;
        let costs = { [startId]: 0 };

        function visitNext() {
            if (!isAlgorithmRunning) return;
            delay = 0;

            if (frontier.length === 0) {
                delayedLog("A*: No path found. Frontier empty.", expanded);
                isAlgorithmRunning = false;
                return;
            }
            frontier.sort((a, b) => (a.cost + getHeuristic(a.node)) - (b.cost + getHeuristic(b.node)));
            const {node: current, cost: currentG} = frontier.shift();

            if (currentG > costs[current]) {
                delayedLog(`A*: Skipping node [${current}] with f‑value ${(currentG + getHeuristic(current))} (better f‑value ${(costs[current] + getHeuristic(current))})`, expanded);
                scheduleTimeout(visitNext, delay);
                return;
            }

            highlightNode(current);
            highlightCurrent(current);
            setNodeCost(current, currentG);
            expanded.push(current);
            scheduleTimeout(() => displayNodeCost(current, currentG), delay - 1);
            if (current === startId) {
                delayedLog(`A*: Root Node ${startId}`, expanded);
            } else {
                delayedLog(`A*: Expanding node [${current}] \nCost = ${currentG} \nHeuristic = ${getHeuristic(current)} \nf‑value = ${currentG + getHeuristic(current)}`, expanded);
            }
            if (current === goalId) {
                let path = [current];
                while (path[0] !== startId) path.unshift(parents[path[0]]);
                currentPath = path;
                highlightPath(path);
                delayedLog(`A*: Goal reached! Path: ${path.join(" -> ")}`, expanded);
                isAlgorithmRunning = false;
                return;
            }

            (adjacency[current] || []).forEach(neighbor => {
                const link = links.find(l => ((l.source.id === current && l.target.id === neighbor) || (l.target.id === current && l.source.id === neighbor)));
                if (!link) return;

                const tentativeG = currentG + link.weight;
                const oldCost = costs[neighbor] ?? "none";
                if (costs[neighbor] === undefined || tentativeG < costs[neighbor]) {
                    costs[neighbor] = tentativeG;
                    parents[neighbor] = current;
                    const nbrNode = getNode(neighbor);
                    if (nbrNode && nbrNode.discoveryIndex === undefined) {
                        nbrNode.discoveryIndex = discoveredCount++;
                    }
                    frontier.push({ node: neighbor, cost: tentativeG });
                    setNodeCost(neighbor, tentativeG);
                    scheduleTimeout(() => displayNodeCost(neighbor, tentativeG), delay - 1);

                    if (oldCost !== "none") {
                        delayedLog(`A*: Reopening node [${neighbor}], Updating g from ${oldCost} to ${tentativeG}`, expanded);
                    } else {
                        delayedLog(`A*: Discovered node [${neighbor}] with Cost = ${tentativeG}`, expanded);
                    }
                }
            });
            delayedLog(`A*: Frontier: [${frontier.map(n => `${n.node}(${(n.cost+getHeuristic(n.node))})`).join(", ")}], \nDiscovered: [${Object.keys(costs).join(", ")}], \nExpanded: [${expanded.join(", ")}]`, expanded);
            scheduleTimeout(visitNext, delay);
        }
        visitNext();
    }


    // --------- Event Listeners ---------

    // Generate Graph Event
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
        const intro = introJs()
        intro.setOptions({
            steps: [
                {   element: "#generateGraphForm",
                    intro: "Enter how many nodes you want and click Generate to build a new random graph.",
                    position: "right"
                },
                {   element: "#sortGraphBtn",
                    intro: "Click this to allow the graph to untangle itself",
                    position: "right"
                },
                {   element: "#weightDiv",
                    intro: "Toggle this to show or hide link weights on the graph.",
                    position: "right"
                },
                {   element: "#heuristicToggleDiv",
                    intro: "Toggle this to show or hide heuristics (H‑values) on each node.",
                    position: "right"
                },
                {   element: "#toastToggleDiv",
                    intro: "Toggle this to hide the step by step pop-up explanation",
                    position: "right"
                },
                {   element: "#selectGoalDiv",
                    intro: "Choose your goal node (or click Set Random Goal).",
                    position: "top"
                },
                {   element: "#selectStartDiv",
                    intro: "Choose your starting node for all searches.",
                    position: "top"
                },
                {   element: "#AddNodeDiv",
                    intro: "Click Add or Delete to modify nodes. Activate a parent by clicking its inner circle first.",
                    position: "right"
                },
                {   element: "#randomizeWeightsDiv",
                    intro: "Toggle this to give the links created to random weights.",
                    position: "bottom"
                },
                {   element: "#updateLinkForm",
                    intro: "Use these controls to create, update, or remove an edge between two nodes.",
                    position: "top"
                },
                {   element: "#resetDiv",
                    intro: "This is where you can reset your tree back to baseline.",
                    position: "top"
                },
                {   element: "#toggleSidebar",
                    intro: "Hide or show the sidebar to give more room to the graph.",
                    position: "left"
                },
                {   element: "#algorithmDropdown",
                    intro: "Pick a search algorithm (BFS, DFS, UCS, or A*).",
                    position: "bottom"
                },
                {   element: "#runAlgorithmBtn",
                    intro: "Run the selected algorithm — watch the traversal animate!",
                    position: "bottom"
                },
                {   element: "#getInfoBtn",
                    intro: "Click this if you would like more information on the algorythm selected",
                    position: "bottom"
                },
                {   element: "#speedControls",
                    intro: "Adjust how fast each step of the algorithm plays.",
                    position: "top"
                },
                {   element: ".backStep",
                    intro: "Step backwards through the algorithm history.",
                    position: "top"
                },
                {   element: ".forwardStep",
                    intro: "Step forwards through the algorithm history.",
                    position: "top"
                },
                {   element: "#graphSvg",
                    intro: "This is the interactive graph area — drag nodes around or click them to activate.",
                    position: "top"
                },
                {   element: "#steps-tab",
                    intro: "This is the History Tab button. Click here to view your past actions.",
                    position: "bottom"
                },
                {   element: "#toggleTreeBtn",
                    intro: "Open the Search Tree panel to see the traversal tree.",
                    position: "left"
                },
                {   element: "#searchTreePanel",
                    intro: "This is where the search tree is displayed — it visualizes the traversal tree with statistics.",
                    position: "left"
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

        });

        intro.onbeforechange(function(targetElement) {
            if (targetElement.id === "searchTreePanel") {
                const panel = document.getElementById("searchTreePanel");
                if (!panel.classList.contains("open")) {
                    document.getElementById("toggleTreeBtn").click();
                }
            }
        });

        intro.onafterchange(function(targetElement) {
            if (targetElement.id !== "searchTreePanel") {
                const panel = document.getElementById("searchTreePanel");
                if (panel.classList.contains("open")) {
                    document.getElementById("toggleTreeBtn").click();
                }
            }
        });

        intro.oncomplete(function() {
            const panel = document.getElementById("searchTreePanel");
            if (panel.classList.contains("open")) {
                document.getElementById("toggleTreeBtn").click();
            }
        });

        intro.onexit(function() {
            const panel = document.getElementById("searchTreePanel");
            if (panel.classList.contains("open")) {
                document.getElementById("toggleTreeBtn").click();
            }
        });

        intro.start();
    });

    // addNode Event
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
        nodes.forEach(n => {
            n.fx = null;
            n.fy = null;
        });
        simulation.alpha(0.5).restart();
    });

    // deleteNode Event
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
        stopAlgorithm();
        d3.selectAll(".node-group").classed("goal-highlight", false);
        const goalId = parseInt(goalNodeSelect.value, 10);

        if (!isNaN(goalId)) {
            updateHeuristics(goalId);
            highlightGoal(goalId);
        }
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
            maybeUpdateHeuristics()
            drawGraph();
            alert("Link weight updated.");
        } else {
            links.push({ source: nodes[node1], target: nodes[node2], weight: newWeight });
            buildAdjacency();
            maybeUpdateHeuristics()
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
            maybeUpdateHeuristics()
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
            <p>
            Breadth-First Search (BFS) explores a graph level by level, starting from the source node.<br><br>
            
            It first visits all the immediate neighbors of the source. Then it continues to their neighbors, and so on.<br><br>
            
            This guarantees that the first time a node is reached, it’s through the shortest possible path.<br><br>
            
            BFS is especially useful for finding the shortest path in an <strong>unweighted graph</strong>, as it always completes one level before moving to the next.
            </p>

            <h4 class="text-center"><u><strong>Example</strong></u></h4>
            <p>Consider the following graph with nodes 0, 1, 2, and 4:</p>
            <div class="text-center">
                <img src="./assets/BFS.png" alt="BFS illustration" class="border rounded w-50">
                <p>Graph: 0 → 1, 0 → 2, 1 → 3</p>
            </div>
            
            <p>Starting from node 0:</p>
            <ul>
              <li>First, BFS explores nodes 1 and 2 (since they are at the same level from 0).</li>
              <li>Then it moves on to node 3, visiting 1 → 3.</li>
            </ul>
            
            <p><strong>The order of visits would be:</strong><br>
            0 → 1, 0 → 2, 1 → 3</p>
                        `;
                break;
            case "dfs":
                html = `
           <h3>Depth‑First Search (DFS)</h3>
            <p>
            Depth-First Search (DFS) explores a graph by going as deep as possible along each branch before backtracking.<br><br>
            
            Starting from the source node, it visits a neighbor, then that neighbor’s neighbor, continuing down until it can’t go further. Then it backtracks and explores unvisited paths.<br><br>

            Unlike BFS, DFS does not guarantee the shortest path in an unweighted graph.
            </p>
            
            <h4 class="text-center"><u><strong>Example</strong></u></h4>
            <p>Consider the following graph with nodes 0, 1, 2, and 4:</p>
            <div class="text-center">
                <img src="./assets/DFS.png" alt="DFS illustration" class="border rounded w-50 mx-auto d-block">
                <p>Graph: 0 → 1, 0 → 2, 1 → 3</p>
            </div>
            
            <p>Starting from node 0:</p>
            <ul>
              <li>DFS goes deep first: from 0 → 1, then from 1 → 3.</li>
              <li>After reaching the end of that path, it backtracks and explores 0 → 2.</li>
            </ul>
            
            <p><strong>The order of visits might be:</strong><br>
            0 → 1, 1 → 3, 0 → 2</p>
                        `;
                break;
            case "ucs":
                html = `
                <h3>Uniform Cost Search (UCS)</h3>
                <p>
                Uniform Cost Search (UCS) is similar to BFS, but it considers the <u>total cost of paths</u> rather than just the number of steps.<br><br>
                
                At each step, UCS expands the node with the <strong>lowest cumulative cost</strong> from the start node.<br><br>
                
                This makes UCS ideal for finding the <strong>least-cost path</strong> in a <u>weighted graph</u>, where some paths may be longer but cheaper.
                </p>
                
                <h4 class="text-center"><u><strong>Example</strong></u></h4>
                <p>Consider the following graph:</p>
                
                <div class="text-center">
                    <img src="./assets/UCS.png" alt="UCS illustration" class="border rounded w-50 mx-auto d-block">
                    <p> Graph: <br>
                        0 → 1 (weight 20),
                        0 → 2 (weight 5),
                        2 → 3 (weight 5),
                        3 → 4 (weight 5),
                        1 → 4 (weight 4)</p>
                </div>
                
                <p>Starting from node 0, UCS proceeds as follows:</p>
                <ul>
                  <li>Explore 0 → 2 (cost 5) first, since it's the lowest cost.</li>
                  <li>Then from 2 → 3 (cost 5) Total cost: 10)</li>
                  <li>Then from 3 → 4 (cost 5) total cost: 15)</li>
                  <li>Lastly, 0 → 1 (cost 19) </li>
                  <li>0 → 1 (cost 19) is less than the cost from 4 → 1 (Cost 5) Total Cost: 20</li>
                </ul>
                
                <p><strong>The order of visits would be:</strong><br>
                0 → 2, 2 → 3, 3 → 4, 0 → 1</p>
                        `;
                break;
            case "aStar":
                html = `
                <h3>A* Search</h3>
                <p>
                A* Search is an informed search algorithm that selects the next node to expand based on both the <u>cost</u> 
                and the <u>estimate of the remaining cost to reach the goal <strong>(heuristic)</strong></u>. A goal is needed to generate the heuristic.
                </p>
                
                <p>
                A heuristic is <strong>admissible</strong> when it never overestimates the true cost to reach the 
                goal. This ensures that A* finds the least‑cost path without exploring unnecessary routes.
                </p>
                
                <h4 class="text-center"><u><strong>Example</strong></u></h4>
                <p>In the graph below, the goal node is <strong>node 1</strong>:</p>
                
                <div class="text-center">
                    <img src="./assets/ASTAR.png" alt="A* illustration" class="border rounded w-50 mx-auto d-block">
                    <p>Graph: <br>
                0 → 1 (weight 19),
                0 → 2 (weight 5),
                2 → 3 (weight 5),
                3 → 4 (weight 5),
                4 → 1 (weight 5)
                    </p>
                </div>
                
                <p>The heuristic estimates cost to reach node 1 (goal) are:</p>
                <ul>
                  <li>Node 0: heuristic 5</li>
                  <li>Node 2: heuristic 10</li>
                  <li>Node 3: heuristic 10</li>
                  <li>Node 4: heuristic 5</li>
                  <li>Node 1 (goal): heuristic 0</li>
                </ul>
                
                <p>Starting from node 0, A* expands nodes in order of: combined total cost (cost) + estimated remaining cost (heuristic):</p>
                <ul>
                  <li>First expand 0 → 2 (cost(5) + heuristic(10) = 15).</li>
                  <li>Then expand 0 → 1 (cost(19) + heuristic(0) = 19).</li>
                  <li>0 → 1 (cost(19) + heuristic(0) = 19) is less than the cost from 2 → 3 (cost(10) + heuristic(10) = 20)</li>
                </ul>
                
                <p><strong>The order of visits is:</strong><br>
                0 → 2, 0 → 1
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

    // Graph Tab Resize Event
    document.getElementById("graph-tab").addEventListener("shown.bs.tab", () => {
        setTimeout(() => {
            resizeGraph()
        }, 0);
    });

    window.addEventListener("resize", () => {
        resizeGraph();
        drawGraph();
        scheduleTreeRedraw();
    });

    // --------- Initialization ------------
    function init() {
        generateRandomGraph(8);
    }
    init();

});