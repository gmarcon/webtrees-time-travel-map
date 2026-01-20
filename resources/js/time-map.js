document.addEventListener('DOMContentLoaded', function () {

    // If no root ID, we can't do anything.
    if (typeof ROOT_ID === 'undefined' || !ROOT_ID) {
        // Can happen if page loaded without parameters
        return;
    }

    // Check for recording mode immediately
    if (new URLSearchParams(window.location.search).has('recording_mode')) {
        document.body.classList.add('recording-mode');
        document.documentElement.classList.add('recording-mode-html');
        // Help user identify this tab in the sharing picker
        document.title = "SELECT THIS AND PRESS SHARE";

        // Try to move focus back to the main window where the permission prompt appears
        if (window.opener) {
            try {
                window.opener.focus();
            } catch (e) {
                console.log("Could not focus opener window");
            }
        }
    }

    // Initialize Map
    const map = L.map('map', {
        fullscreenControl: false, // We use custom control
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Custom Fullscreen Control
    const FullscreenControl = L.Control.extend({
        options: {
            position: 'topleft'
        },
        onAdd: function (map) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const button = L.DomUtil.create('a', 'leaflet-control-custom-fullscreen', container);
            button.href = '#';
            button.title = 'Toggle Fullscreen';
            button.innerHTML = FULLSCREEN_ICON_HTML || '⛶';

            L.DomEvent.on(button, 'click', function (e) {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                toggleFullscreen();
            });

            return container;
        }
    });
    map.addControl(new FullscreenControl());

    function toggleFullscreen() {
        const wrapper = document.getElementById('time-travel-wrapper');

        if (!document.fullscreenElement) {
            if (wrapper.requestFullscreen) {
                wrapper.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else if (wrapper.webkitRequestFullscreen) {
                wrapper.webkitRequestFullscreen();
            } else if (wrapper.msRequestFullscreen) {
                wrapper.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    // Aggressive resizing check
    function checkMapSize() {
        if (map) {
            map.invalidateSize();
        }
    }

    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
        document.addEventListener(evt, function () {
            const wrapper = document.getElementById('time-travel-wrapper');
            if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) {
                if (wrapper) wrapper.classList.add('is-fullscreen');
            } else {
                if (wrapper) wrapper.classList.remove('is-fullscreen');
            }

            // Check immediately and repeatedly for a short duration
            checkMapSize();
            setTimeout(checkMapSize, 100);
            setTimeout(checkMapSize, 300);
            setTimeout(checkMapSize, 500);
        });
    });

    // Controls
    const slider = document.getElementById('year-slider');
    const yearDisplay = document.getElementById('year-display');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const reverseBtn = document.getElementById('reverse-btn');
    const speedSelect = document.getElementById('speed-select');
    const loadingOverlay = document.getElementById('loading-overlay');
    const parentsCheck = document.getElementById('show-parents-check');
    const autozoomCheck = document.getElementById('autozoom-check');
    const calloutsCheck = document.getElementById('show-callouts-check');
    const histogramCanvas = document.getElementById('timeline-histogram');
    const recordBtn = document.getElementById('record-btn');

    let isRecordingPrep = false; // Flag to indicate we are setting up recording
    let mediaRecorder = null;
    let recordedChunks = [];

    let individuals = [];
    let visibleMarkers = {}; // Map of id -> L.marker
    let displacementLines = {}; // Map of id -> L.polyline
    let parentLines = []; // Array of L.polyline
    let histogramCounts = {}; // year -> count
    let maxCount = 0;

    // Cluster Group
    let markersCluster = L.markerClusterGroup();
    let centerMarkerLayer = L.layerGroup().addTo(map);

    let isPlaying = false;
    let playDirection = 1;
    let minYear = 1700;
    let maxYear = new Date().getFullYear();
    let currentYear = 1800;

    // Flag to distinguish code-driven zooms from user interaction
    let isProgrammaticZoom = false;

    // Show loading
    function showLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    // Hide loading
    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    // Create callout icon
    function createCalloutIcon(person, showCallouts, angle = -90) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';

        if (!showCallouts) {
            // Cluster Mode / Dot Only (if needed, though mainly handled by ClusterGroup default or custom logic)
            // We can return a simple dot div
            return L.divIcon({
                className: 'custom-callout-icon',
                html: `<div class="callout-dot"></div>`,
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });
        }

        // Hub & Spoke Mode: BUBBLE ONLY
        // The dot is handled by the Center Marker. The line is handled by the Displacement Line.
        // We just need the bubble, centered on the anchor (which is the displaced position).

        return L.divIcon({
            className: 'custom-callout-icon',
            html: `<div class="callout-bubble" style="transform: translate(-50%, -50%); display:block;">
                        <div class="person-name">${person.name}</div>
                        <span class="years">(${birth}-${death})</span>
                   </div>`,
            iconSize: null,
            iconAnchor: [0, 0] // Centered on the point
        });
    }

    function getColorForPerson(id) {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + "00000".substring(0, 6 - c.length) + c;
    }

    // Histogram Logic
    function calculateHistogram() {
        histogramCounts = {};
        maxCount = 0;
        for (let y = minYear; y <= maxYear; y++) {
            let count = 0;
            individuals.forEach(p => {
                const birth = p.yearFrom ? parseInt(p.yearFrom) : null;
                const death = p.yearTo ? parseInt(p.yearTo) : null;

                // Logic: Alive if year >= birth AND year <= death
                // If birth is missing, we assume they are NOT alive before a known death? 
                // Or we skip. Let's be strict: need birth.
                // If death is missing, assume alive until MaxYear? Or maybe 100 years?
                // For simplicity, let's say if we have birth, they are alive from birth to (death or birth+100 or current date)

                if (birth !== null) {
                    let end = death;
                    if (end === null) end = Math.min(new Date().getFullYear(), birth + 100);

                    if (y >= birth && y <= end) {
                        count++;
                    }
                }
            });
            histogramCounts[y] = count;
            if (count > maxCount) maxCount = count;
        }
    }

    function drawHistogram(highlightYear) {
        if (!histogramCanvas) return;
        const ctx = histogramCanvas.getContext('2d');
        const width = histogramCanvas.width = histogramCanvas.clientWidth;
        const height = histogramCanvas.height = histogramCanvas.clientHeight;

        ctx.clearRect(0, 0, width, height);

        if (maxCount === 0) return;

        const range = maxYear - minYear;
        if (range <= 0) return;

        const barWidth = Math.max(1, width / (range + 1));

        ctx.fillStyle = '#ccc';

        for (let y = minYear; y <= maxYear; y++) {
            const count = histogramCounts[y] || 0;
            if (count === 0) continue;

            const barHeight = (count / maxCount) * height;
            const x = ((y - minYear) / range) * width;
            const yPos = height - barHeight;

            if (y === highlightYear) {
                ctx.fillStyle = '#0d6efd'; // Bootstrap primary
                ctx.fillRect(x, yPos, barWidth, barHeight);
                ctx.fillStyle = '#ccc';
            } else {
                ctx.fillRect(x, yPos, barWidth, barHeight);
            }
        }
    }

    // Load Data
    function loadData() {
        showLoading();

        const params = new URLSearchParams();
        params.append('root_person_id', ROOT_ID);
        params.append('direction', DIRECTION);
        params.append('generations', GENERATIONS); // If 0 (All)

        let fetchUrl = DATA_URL;
        if (fetchUrl.includes('?')) {
            fetchUrl += '&' + params.toString();
        } else {
            fetchUrl += '?' + params.toString();
        }

        fetch(fetchUrl)
            .then(response => response.json())
            .then(data => {
                hideLoading();
                if (data.error) {
                    alert(data.error);
                    return;
                }

                individuals = data.individuals || [];
                const meta = data.metadata || {};

                if (individuals.length === 0) {
                    alert("No data found for this person/criteria.");
                    return;
                }

                // Update Timeline Range
                if (meta.min_year && meta.max_year) {
                    minYear = meta.min_year;
                    maxYear = meta.max_year;
                } else {
                    minYear = 1700;
                    maxYear = new Date().getFullYear();
                }

                slider.min = minYear;
                slider.max = maxYear;

                // Initial Slider Position
                if (DIRECTION === 'DOWN') {
                    slider.value = minYear;
                    playDirection = 1;
                } else {
                    slider.value = maxYear;
                    playDirection = -1;
                }
                currentYear = parseInt(slider.value);
                yearDisplay.innerText = currentYear;

                // Fit bounds initially
                fitBoundsToAll();

                calculateHistogram();
                updateMap(currentYear);

                // Notify if in recording mode
                if (window.opener && new URLSearchParams(window.location.search).has('recording_mode')) {
                    window.opener.postMessage({ action: 'CHILD_READY' }, '*');
                }
            })
            .catch(err => {
                hideLoading();
                console.error('Error loading data:', err);
                alert('Error loading data. See console for details.');
            });
    }

    function fitBoundsToAll() {
        let allLat = [];
        let allLng = [];
        individuals.forEach(ind => {
            ind.events.forEach(e => {
                allLat.push(e.coords[0]);
                allLng.push(e.coords[1]);
            });
        });
        if (allLat.length > 0) {
            const bounds = L.latLngBounds(
                [Math.min(...allLat), Math.min(...allLng)],
                [Math.max(...allLat), Math.max(...allLng)]
            );
            isProgrammaticZoom = true;
            map.fitBounds(bounds, { padding: [50, 50] });
            setTimeout(() => { isProgrammaticZoom = false; }, 100);
        }
    }

    function getPositionAtYear(person, year) {
        const validEvents = person.events.filter(e => e.coords && e.coords.length === 2);
        if (validEvents.length === 0) return null;

        let bestEvent = null;
        for (let i = 0; i < validEvents.length; i++) {
            if (validEvents[i].year <= year) {
                bestEvent = validEvents[i];
            } else {
                break; // Events are sorted by year
            }
        }

        if (!bestEvent) {
            if (person.yearFrom && year >= person.yearFrom) {
                return { lat: validEvents[0].coords[0], lng: validEvents[0].coords[1], event: validEvents[0] };
            }
            return null;
        }
        return { lat: bestEvent.coords[0], lng: bestEvent.coords[1], event: bestEvent };
    }

    // List of events that indicate a user might be trying to override autozoom (zoom or drag)
    map.on('zoomstart', function () {
        if (!isProgrammaticZoom && autozoomCheck && autozoomCheck.checked) {
            autozoomCheck.checked = false;
            // Visual Effect only if playing
            if (isPlaying && autozoomCheck.parentElement) {
                const label = autozoomCheck.parentElement.querySelector('label') || autozoomCheck.parentElement;
                label.classList.add('blink-text');
            }
        }
    });

    // Zoom listener to re-calculate positions
    map.on('zoomend', function () {
        if (calloutsCheck && calloutsCheck.checked) {
            const cObj = parseInt(slider.value);
            updateMap(cObj);
            // Also sync global variable just in case
            currentYear = cObj;
        }
    });

    function getDisplacedCoords(centerLat, centerLng, index, total) {
        // Default: Single Item -> Displace North
        let radius = 50;
        let angleDeg = -90; // North
        let angleRad = angleDeg * (Math.PI / 180);

        if (total > 1) {
            // Spiral Layout (Phyllotaxis / Archimedean)
            const angleStep = 137.5; // Golden Angle in degrees
            angleDeg = index * angleStep;
            angleRad = angleDeg * (Math.PI / 180);
            // Radius grows with square root of index
            radius = 50 + (30 * Math.sqrt(index));
        }

        // Convert center to pixel point
        const centerPoint = map.latLngToLayerPoint([centerLat, centerLng]);

        // MAX RADIUS CONSTRAINT: 10km diameter (5km radius)
        // 1 degree latitude is approx 111km
        // 5km is approx 5/111 = 0.045045 degrees
        const centerLatLng = L.latLng(centerLat, centerLng);
        const offsetLatLng = L.latLng(centerLat + 0.045, centerLng);
        const centerP = map.latLngToLayerPoint(centerLatLng);
        const offsetP = map.latLngToLayerPoint(offsetLatLng);
        const maxRadiusPx = Math.abs(offsetP.y - centerP.y);

        // Clamp the radius
        if (radius > maxRadiusPx) {
            radius = maxRadiusPx;
        }

        // Calculate new pixel position
        const newX = centerPoint.x + radius * Math.cos(angleRad);
        const newY = centerPoint.y + radius * Math.sin(angleRad);

        // Convert back to LatLng
        const newLatLng = map.layerPointToLatLng([newX, newY]);

        return { lat: newLatLng.lat, lng: newLatLng.lng, angle: angleDeg };
    }

    function updateMap(year) {
        // 1. Identify Valid People & Locations
        const currentActive = []; // { person, pos: {lat, lng, event} }
        const coordsMap = {}; // "lat,lng" -> [ {person, pos} ]
        const showCallouts = calloutsCheck ? calloutsCheck.checked : true;

        individuals.forEach(person => {
            const birth = person.yearFrom || -9999;
            const death = person.yearTo || 9999;

            if (year < birth || year > death) return;

            const pos = getPositionAtYear(person, year);
            if (!pos) return;

            const wrapper = { person, pos };
            currentActive.push(wrapper);

            const key = `${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}`;
            if (!coordsMap[key]) coordsMap[key] = [];
            coordsMap[key].push(wrapper);
        });

        // Mode Check
        if (showCallouts) {
            // --- MODE: Displacement (Hub & Spoke) ---
            if (map.hasLayer(markersCluster)) {
                map.removeLayer(markersCluster);
                markersCluster.clearLayers();
            }
            // Clear Center Dots
            centerMarkerLayer.clearLayers();

            // 2. Calculate Final Positions (Handling Clusters manually)
            const finalPositions = {}; // personId -> { lat, lng, isDisplaced, origin: {lat,lng}, angle }

            Object.keys(coordsMap).forEach(key => {
                const cluster = coordsMap[key];
                const originLat = cluster[0].pos.lat;
                const originLng = cluster[0].pos.lng;

                // DRAW CENTER DOT for this location
                const centerDot = L.circleMarker([originLat, originLng], {
                    radius: 5,
                    fillColor: '#0d6efd',
                    color: '#fff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 1
                });
                centerDot.on('click', () => {
                    // Maybe zoom in or show list?
                    map.flyTo([originLat, originLng], map.getZoom() + 2);
                });
                centerMarkerLayer.addLayer(centerDot);

                // Sort cluster to keep consistent order
                cluster.sort((a, b) => {
                    const yA = parseInt(a.person.yearFrom) || 0;
                    const yB = parseInt(b.person.yearFrom) || 0;
                    if (yA !== yB) return yA - yB;
                    return a.person.id.localeCompare(b.person.id);
                });

                // Apply Displacement to ALL items (Single or Cluster)
                cluster.forEach((item, index) => {
                    const displaced = getDisplacedCoords(originLat, originLng, index, cluster.length);
                    finalPositions[item.person.id] = {
                        lat: displaced.lat,
                        lng: displaced.lng,
                        isDisplaced: true, // Always true now for consistency
                        origin: { lat: originLat, lng: originLng },
                        angle: displaced.angle
                    };
                });
            });

            // 3. Update Markers & Lines
            const activeIds = new Set(currentActive.map(i => i.person.id));
            const activeCoords = [];

            // Remove old markers/lines
            Object.keys(visibleMarkers).forEach(id => {
                if (!activeIds.has(id)) {
                    map.removeLayer(visibleMarkers[id]);
                    delete visibleMarkers[id];
                    if (displacementLines[id]) {
                        map.removeLayer(displacementLines[id]);
                        delete displacementLines[id];
                    }
                }
            });

            // Update/Create new
            currentActive.forEach(item => {
                const person = item.person;
                const target = finalPositions[person.id];
                activeCoords.push([target.lat, target.lng]);

                // Bubble Marker
                const newLatLng = new L.LatLng(target.lat, target.lng);
                if (visibleMarkers[person.id]) {
                    const marker = visibleMarkers[person.id];
                    const oldLatLng = marker.getLatLng();
                    if (oldLatLng.distanceTo(newLatLng) > 0) {
                        marker.setLatLng(newLatLng);
                    }
                    marker.setIcon(createCalloutIcon(person, true, target.angle));
                    if (!map.hasLayer(marker)) marker.addTo(map);
                } else {
                    const marker = L.marker(newLatLng, {
                        icon: createCalloutIcon(person, true, target.angle)
                    });
                    marker.bindPopup(buildPopupContent(person), { maxWidth: 350, minWidth: 250 });
                    marker.addTo(map);
                    visibleMarkers[person.id] = marker;
                }

                // Displacement Line (Gray Line)
                const origin = target.origin;
                // Draw line only if distance > 0 (it will be 0 for single items not displaced)
                // Actually, if we want "Hub and Spoke", we should verify if we want lines for single items?
                // If single item, Dot is at Center. Bubble is at Center. Line length 0.
                if (target.lat !== origin.lat || target.lng !== origin.lng) {
                    const linePoints = [[origin.lat, origin.lng], [target.lat, target.lng]];
                    if (displacementLines[person.id]) {
                        displacementLines[person.id].setLatLngs(linePoints);
                        if (!map.hasLayer(displacementLines[person.id])) displacementLines[person.id].addTo(map);
                    } else {
                        const line = L.polyline(linePoints, {
                            color: '#999', // Gray
                            weight: 1,
                            opacity: 0.8
                        }).addTo(map);
                        displacementLines[person.id] = line;
                    }
                } else {
                    // Remove line if exists (collapsed to center)
                    if (displacementLines[person.id]) {
                        map.removeLayer(displacementLines[person.id]);
                        delete displacementLines[person.id];
                    }
                }
            });

            // 4. Handle Parent Lines
            if (parentsCheck && parentsCheck.checked) {
                drawParentLines(currentActive, finalPositions);
            } else {
                clearParentLines();
            }

            // 6. Handle Autozoom
            if (autozoomCheck && autozoomCheck.checked) {
                if (activeCoords.length > 0) {
                    const bounds = L.latLngBounds(activeCoords);
                    isProgrammaticZoom = true;
                    map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
                    setTimeout(() => { isProgrammaticZoom = false; }, 100);
                }
            }

        } else {
            // --- MODE: Clustering (Leaflet.markercluster) ---
            centerMarkerLayer.clearLayers();

            // Clean up displacement mode stuff
            Object.keys(visibleMarkers).forEach(id => {
                map.removeLayer(visibleMarkers[id]);
                delete visibleMarkers[id];
            });
            Object.keys(displacementLines).forEach(id => {
                map.removeLayer(displacementLines[id]);
                delete displacementLines[id];
            });
            clearParentLines();

            // Rebuild Cluster
            markersCluster.clearLayers();
            const clusterMarkers = [];
            const activeCoords = [];

            // Simple positions (no displacement)
            const activePos = {};

            currentActive.forEach(item => {
                const person = item.person;
                const pos = item.pos;
                activePos[person.id] = { lat: pos.lat, lng: pos.lng };
                activeCoords.push([pos.lat, pos.lng]);

                const marker = L.marker([pos.lat, pos.lng], {
                    icon: createCalloutIcon(person, false)
                });
                marker.bindPopup(buildPopupContent(person), { maxWidth: 350, minWidth: 250 });
                clusterMarkers.push(marker);
            });

            markersCluster.addLayers(clusterMarkers);
            if (!map.hasLayer(markersCluster)) {
                map.addLayer(markersCluster);
            }

            if (parentsCheck && parentsCheck.checked) {
                drawParentLines(currentActive, activePos);
            }

            if (autozoomCheck && autozoomCheck.checked) {
                if (activeCoords.length > 0) {
                    const bounds = L.latLngBounds(activeCoords);
                    isProgrammaticZoom = true;
                    map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
                    setTimeout(() => { isProgrammaticZoom = false; }, 100);
                }
            }
        }

        drawHistogram(year);
    }

    function buildPopupContent(person) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';

        let html = `<div class="custom-popup" style="overflow:hidden;">`;

        // Thumbnail
        if (person.thumb) {
            html += `<img src="${person.thumb}" class="popup-thumbnail" alt="Thumb">`;
        }

        html += `<h6 style="margin-bottom:0; font-weight:bold;">
                    <a href="${person.url}" target="_parent">${person.name}</a> 
                    <span style="font-weight:normal;">(${birth}-${death})</span>
                 </h6>
            <div style="clear:both;"></div>
            <hr style="margin:5px 0;">
            <div class="event-list" style="max-height: 250px; overflow-y: auto;">`;

        person.events.forEach(ev => {
            const place = ev.location || '';
            const date = ev.GEDdate || '';
            // Format: Year Type in Place (Date)
            html += `<div class="event-item" style="margin-bottom: 4px;">
                <span style="font-weight:bold;">${ev.year}</span> ${ev.event_label}`;

            if (place) {
                html += ` in <span class="text-muted">${place}</span>`;
            }
            if (date) {
                html += ` <small class="text-muted">(${date})</small>`;
            }
            html += `</div>`;
        });

        html += `</div></div>`;
        return html;
    }

    function clearParentLines() {
        parentLines.forEach(l => map.removeLayer(l));
        parentLines = [];
    }

    function drawParentLines(activePeople, finalPositions) {
        clearParentLines();

        const activePos = finalPositions;

        activePeople.forEach(ap => {
            const p = ap.person;
            const from = activePos[p.id];

            if (!from) return;

            if (p.father && activePos[p.father]) {
                const to = activePos[p.father];
                const line = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
                    color: '#333',
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: '4, 4'
                }).addTo(map);
                parentLines.push(line);
            }
            if (p.mother && activePos[p.mother]) {
                const to = activePos[p.mother];
                const line = L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
                    color: '#333',
                    weight: 1.5,
                    opacity: 0.5,
                    dashArray: '4, 4'
                }).addTo(map);
                parentLines.push(line);
            }
        });
    }

    function updateCalloutVisibility() {
        // Toggle visibility of callout bubbles based on checkbox state
        const showCallouts = calloutsCheck ? calloutsCheck.checked : true;

        Object.keys(visibleMarkers).forEach(id => {
            const marker = visibleMarkers[id];
            const el = marker.getElement();
            if (el) {
                const bubble = el.querySelector('.callout-bubble');
                if (bubble) {
                    bubble.style.display = showCallouts ? '' : 'none';
                }
            }
        });
    }



    // Playback Logic
    function step() {
        if (!isPlaying) return;

        currentYear = parseInt(slider.value);

        if (playDirection === 1 && currentYear >= maxYear) {
            isPlaying = false;
            if (new URLSearchParams(window.location.search).has('recording_mode') && window.opener) {
                window.opener.postMessage({ action: 'PLAYBACK_FINISHED' }, '*');
            }
            return;
        }
        if (playDirection === -1 && currentYear <= minYear) {
            isPlaying = false;
            if (new URLSearchParams(window.location.search).has('recording_mode') && window.opener) {
                window.opener.postMessage({ action: 'PLAYBACK_FINISHED' }, '*');
            }
            return;
        }

        slider.value = currentYear + playDirection;
        yearDisplay.innerText = slider.value;
        const nextYear = parseInt(slider.value);
        updateMap(nextYear);

        const speed = parseInt(speedSelect.value);
        const baseDelay = 500;
        const delay = baseDelay / speed;

        setTimeout(() => {
            requestAnimationFrame(step);
        }, delay);
    }

    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (recordBtn && recordBtn.classList.contains('active')) {
                startRecordingSequence(1);
                return;
            }
            playDirection = 1;
            if (isPlaying) return;
            isPlaying = true;
            step();
        });
    }

    if (reverseBtn) {
        reverseBtn.addEventListener('click', () => {
            if (recordBtn && recordBtn.classList.contains('active')) {
                startRecordingSequence(-1);
                return;
            }
            playDirection = -1;
            if (isPlaying) return;
            isPlaying = true;
            step();
        });
    }

    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            isPlaying = false;
        });
    }

    if (slider) {
        slider.addEventListener('input', () => {
            yearDisplay.innerText = slider.value;
            currentYear = parseInt(slider.value);
            updateMap(currentYear);
        });
    }

    // Event Listeners for new controls
    if (parentsCheck) {
        parentsCheck.addEventListener('change', () => {
            updateMap(parseInt(slider.value));
        });
    }



    if (autozoomCheck) {
        autozoomCheck.addEventListener('change', () => {
            if (autozoomCheck.parentElement) {
                const label = autozoomCheck.parentElement.querySelector('label') || autozoomCheck.parentElement;
                label.classList.remove('blink-text');
            }
            updateMap(parseInt(slider.value));
        });
    }

    if (recordBtn) {
        recordBtn.addEventListener('click', () => {
            recordBtn.classList.toggle('active');
        });
    }

    function startRecordingSequence(direction) {
        // 1. Open Popup
        const width = 1200;
        const height = 800;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;

        const url = new URL(window.location.href);
        url.searchParams.set('recording_mode', '1');

        // Open in new tab (no window features = tab usually)
        const recWin = window.open(url.toString(), '_blank');

        const messageHandler = (event) => {
            if (event.source !== recWin) return;

            if (event.data.action === 'CHILD_READY') {
                // 3. Request Permission
                navigator.mediaDevices.getDisplayMedia({
                    video: { cursor: "never" },
                    audio: false
                }).then(stream => {
                    // 4. Start Recording
                    mediaRecorder = new MediaRecorder(stream);
                    recordedChunks = [];

                    mediaRecorder.ondataavailable = e => {
                        if (e.data.size > 0) recordedChunks.push(e.data);
                    };

                    mediaRecorder.onstop = () => {
                        const blob = new Blob(recordedChunks, { type: 'video/webm' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = url;
                        // Use a nice filename
                        const name = (typeof TREE_NAME !== 'undefined') ? TREE_NAME : 'map';
                        a.download = `time-travel-${name}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
                        document.body.appendChild(a);
                        a.click();
                        setTimeout(() => {
                            document.body.removeChild(a);
                            window.URL.revokeObjectURL(url);
                        }, 100);

                        // Cleanup
                        recWin.close(); // Ensure window closes
                        window.removeEventListener('message', messageHandler);

                        // Toggle off record button
                        if (recordBtn) recordBtn.classList.remove('active');
                    };

                    mediaRecorder.start();

                    // 5. Tell Child to Play
                    // Get current map state
                    const center = map.getCenter();
                    const zoom = map.getZoom();

                    recWin.postMessage({
                        action: 'START_PLAYBACK',
                        startYear: parseInt(slider.value),
                        direction: direction,
                        speed: parseInt(speedSelect.value),
                        showParents: parentsCheck ? parentsCheck.checked : false,
                        showCallouts: calloutsCheck ? calloutsCheck.checked : true,
                        autozoom: autozoomCheck ? autozoomCheck.checked : false,
                        center: { lat: center.lat, lng: center.lng },
                        zoom: zoom
                    }, '*');

                    // Stop recording if the user stops sharing via browser UI
                    stream.getVideoTracks()[0].onended = () => {
                        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                            mediaRecorder.stop();
                        }
                    };

                }).catch(err => {
                    console.error("Error/Cancel recording:", err);
                    recWin.close();
                    window.removeEventListener('message', messageHandler);
                });
            }

            if (event.data.action === 'PLAYBACK_FINISHED') {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    mediaRecorder.stop();
                    // Stop tracks
                    if (mediaRecorder.stream) {
                        mediaRecorder.stream.getTracks().forEach(track => track.stop());
                    }
                }
            }
        };

        window.addEventListener('message', messageHandler);
    }

    // Child Window Listener
    window.addEventListener('message', (event) => {
        if (event.data.action === 'START_PLAYBACK') {
            const data = event.data;
            if (slider) {
                slider.value = data.startYear;
                currentYear = data.startYear;
                yearDisplay.innerText = currentYear;
            }
            if (parentsCheck) parentsCheck.checked = data.showParents;
            if (calloutsCheck) calloutsCheck.checked = data.showCallouts;

            // Sync autozoom - directly set property and trigger if needed? 
            // Usually step() handles autozoom if checked.
            if (autozoomCheck) {
                autozoomCheck.checked = data.autozoom;
            }

            if (speedSelect) speedSelect.value = data.speed;

            // Apply View
            if (data.center && data.zoom) {
                isProgrammaticZoom = true;
                map.setView([data.center.lat, data.center.lng], data.zoom);
                setTimeout(() => { isProgrammaticZoom = false; }, 300);
            }

            // Restore title for the actual recording/viewing (optional)
            if (typeof TREE_NAME !== 'undefined') {
                document.title = "Time Travel Map - " + TREE_NAME;
            }

            // Force one update before starting to ensure visual state is correct
            updateMap(currentYear);

            // Start
            playDirection = data.direction;
            isPlaying = true;
            step();
        }
    });

    if (calloutsCheck) {
        calloutsCheck.addEventListener('change', () => {
            // Instead of just toggling CSS, we need to rebuild map to switch between Cluster and Spread modes
            updateMap(parseInt(slider.value));
        });
    }

    // Start
    loadData();
});
