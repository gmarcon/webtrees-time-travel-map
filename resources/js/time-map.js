document.addEventListener('DOMContentLoaded', function () {

    // If no root ID, we can't do anything.
    if (typeof ROOT_ID === 'undefined' || !ROOT_ID) {
        // Can happen if page loaded without parameters
        return;
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
    const calloutCheck = document.getElementById('show-callout-check');
    const histogramCanvas = document.getElementById('timeline-histogram');

    let individuals = [];
    let visibleMarkers = {}; // Map of id -> L.marker
    let displacementLines = {}; // Map of id -> L.polyline
    let parentLines = []; // Array of L.polyline
    let histogramCounts = {}; // year -> count
    let maxCount = 0;

    // Cluster Group
    let markersCluster = L.markerClusterGroup();

    let isPlaying = false;
    let playDirection = 1;
    let minYear = 1700;
    let maxYear = new Date().getFullYear();
    let currentYear = 1800;

    // Show loading
    function showLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    // Hide loading
    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    // Create callout icon
    function createCalloutIcon(person, showCallout) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';
        const displayStyle = showCallout ? '' : 'display:none;';

        return L.divIcon({
            className: 'custom-callout-icon',
            // Structure: Wrapper > Dot + Bubble
            html: `<div class="callout-wrapper">
                     <div class="callout-dot"></div>
                     <div class="callout-bubble" style="${displayStyle}">
                        ${person.name}<span class="years">(${birth}-${death})</span>
                     </div>
                   </div>`,
            iconSize: null,
            iconAnchor: [0, 0] // Wrapper handles positioning
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
            map.fitBounds(bounds, { padding: [50, 50] });
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

    function getDisplacedCoords(centerLat, centerLng, index, total) {
        if (total <= 1) return { lat: centerLat, lng: centerLng };

        // Radius: Start with base 0.02 (~2km) and grow if needed
        const radius = Math.max(0.02, total * 0.003);

        // Distribute evenly around the circle
        const angleStep = 360 / total;
        const angleDeg = (index * angleStep) - 90; // Start at top (-90 degrees)
        const angleRad = angleDeg * (Math.PI / 180);

        // Aspect ratio correction for latitude
        const latRad = centerLat * (Math.PI / 180);
        const lngScale = 1 / Math.cos(latRad);

        const newLat = centerLat + radius * Math.sin(angleRad);
        const newLng = centerLng + (radius * Math.cos(angleRad)) * lngScale;

        return { lat: newLat, lng: newLng };
    }

    function updateMap(year) {
        // 1. Identify Valid People & Locations
        const currentActive = []; // { person, pos: {lat, lng, event} }
        const coordsMap = {}; // "lat,lng" -> [ {person, pos} ]
        const showCallout = calloutCheck ? calloutCheck.checked : true;

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

        // Clear existing markers/lines from map if switching modes or updating
        // Logic: activeIds tracks people who SHOULD be on map. 
        // We will rebuild mostly everything to be safe or update existing.

        // Mode Check
        if (showCallout) {
            // --- MODE: Displacement (Spider Layout) ---
            if (map.hasLayer(markersCluster)) {
                map.removeLayer(markersCluster);
                markersCluster.clearLayers();
            }

            // 2. Calculate Final Positions (Handling Clusters manually)
            const finalPositions = {}; // personId -> { lat, lng, isDisplaced, origin: {lat,lng} }

            Object.keys(coordsMap).forEach(key => {
                const cluster = coordsMap[key];
                const originLat = cluster[0].pos.lat;
                const originLng = cluster[0].pos.lng;

                if (cluster.length === 1) {
                    const p = cluster[0];
                    finalPositions[p.person.id] = {
                        lat: originLat,
                        lng: originLng,
                        isDisplaced: false
                    };
                } else {
                    // Cluster
                    cluster.sort((a, b) => {
                        const yA = parseInt(a.person.yearFrom) || 0;
                        const yB = parseInt(b.person.yearFrom) || 0;
                        if (yA !== yB) return yA - yB;
                        return a.person.id.localeCompare(b.person.id);
                    });

                    cluster.forEach((item, index) => {
                        const displaced = getDisplacedCoords(originLat, originLng, index, cluster.length);
                        finalPositions[item.person.id] = {
                            lat: displaced.lat,
                            lng: displaced.lng,
                            isDisplaced: true,
                            origin: { lat: originLat, lng: originLng }
                        };
                    });
                }
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

                // Marker
                const newLatLng = new L.LatLng(target.lat, target.lng);
                if (visibleMarkers[person.id]) {
                    const marker = visibleMarkers[person.id];
                    const oldLatLng = marker.getLatLng();
                    // Small threshold to avoid jitter
                    if (oldLatLng.distanceTo(newLatLng) > 1) {
                        marker.setLatLng(newLatLng);
                    }
                    if (!map.hasLayer(marker)) marker.addTo(map);
                } else {
                    const marker = L.marker(newLatLng, {
                        icon: createCalloutIcon(person, true)
                    });
                    marker.on('click', () => {
                        const content = buildPopupContent(person);
                        marker.bindPopup(content, { maxWidth: 350, minWidth: 250 }).openPopup();
                    });
                    marker.addTo(map);
                    visibleMarkers[person.id] = marker;
                }

                // Displacement Line
                if (target.isDisplaced) {
                    const origin = target.origin;
                    const linePoints = [[origin.lat, origin.lng], [target.lat, target.lng]];

                    if (displacementLines[person.id]) {
                        displacementLines[person.id].setLatLngs(linePoints);
                        if (!map.hasLayer(displacementLines[person.id])) displacementLines[person.id].addTo(map);
                    } else {
                        const line = L.polyline(linePoints, {
                            color: '#666',
                            weight: 1,
                            opacity: 0.6
                        }).addTo(map);
                        displacementLines[person.id] = line;
                    }
                } else {
                    // Remove line if exists
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
                    map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
                }
            }

        } else {
            // --- MODE: Clustering (Leaflet.markercluster) ---

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

                // Create standard marker or small circle for cluster
                // Since "callout" is off, we can use a standard icon or simple dot
                // Let's use the 'createCalloutIcon' but with hidden bubble as implemented or just a standard marker?
                // The task implies "disable callouts", so we use the icon without bubble.
                // Re-creating marker each time for cluster might be expensive but standard for cluster updates usually.

                const marker = L.marker([pos.lat, pos.lng], {
                    icon: createCalloutIcon(person, false) // False = Hide bubble
                });
                marker.bindPopup(buildPopupContent(person), { maxWidth: 350, minWidth: 250 });
                clusterMarkers.push(marker);
            });

            markersCluster.addLayers(clusterMarkers);
            if (!map.hasLayer(markersCluster)) {
                map.addLayer(markersCluster);
            }

            // 4. Handle Parent Lines (Optional in cluster mode? Lines might look weird appearing from inside clusters)
            if (parentsCheck && parentsCheck.checked) {
                // We can draw lines between exact positions, Leaflet handles lines 'under' clusters usually ok
                // or we might want to disable them.
                // Let's try to draw them.
                drawParentLines(currentActive, activePos);
            }

            if (autozoomCheck && autozoomCheck.checked) {
                if (activeCoords.length > 0) {
                    const bounds = L.latLngBounds(activeCoords);
                    map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
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
        const showCallout = calloutCheck ? calloutCheck.checked : true;

        Object.keys(visibleMarkers).forEach(id => {
            const marker = visibleMarkers[id];
            const el = marker.getElement();
            if (el) {
                const bubble = el.querySelector('.callout-bubble');
                if (bubble) {
                    bubble.style.display = showCallout ? '' : 'none';
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
            return;
        }
        if (playDirection === -1 && currentYear <= minYear) {
            isPlaying = false;
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
            playDirection = 1;
            if (isPlaying) return;
            isPlaying = true;
            step();
        });
    }

    if (reverseBtn) {
        reverseBtn.addEventListener('click', () => {
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
            updateMap(parseInt(slider.value));
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
            updateMap(parseInt(slider.value));
        });
    }

    if (calloutCheck) {
        calloutCheck.addEventListener('change', () => {
            // Instead of just toggling CSS, we need to rebuild map to switch between Cluster and Spread modes
            updateMap(parseInt(slider.value));
        });
    }

    // Start
    loadData();
});
