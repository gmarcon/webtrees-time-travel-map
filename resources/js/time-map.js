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

    let individuals = [];
    let visibleMarkers = {}; // Map of id -> L.marker
    let displacementLines = {}; // Map of id -> L.polyline
    let parentLines = []; // Array of L.polyline

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
    function createCalloutIcon(person) {
        const birth = person.yearFrom || '?';
        const death = person.yearTo || '?';

        return L.divIcon({
            className: 'custom-callout-icon',
            // Structure: Wrapper > Dot + Bubble
            html: `<div class="callout-wrapper">
                     <div class="callout-dot"></div>
                     <div class="callout-bubble">
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

        // 2. Calculate Final Positions (Handling Clusters)
        const finalPositions = {}; // personId -> { lat, lng, isDisplaced, origin: {lat,lng} }
        const nextClusterState = {};

        Object.keys(coordsMap).forEach(key => {
            const cluster = coordsMap[key];
            const originLat = cluster[0].pos.lat;
            const originLng = cluster[0].pos.lng;

            if (cluster.length === 1) {
                // Special case: Single person. 
                // However, to maintain stability if they were previously part of a cluster, 
                // we should check if we want to reset reset them or keep spiraling.
                // But usually 1 person = center. 
                // Let's reset to center if alone.
                const p = cluster[0];
                finalPositions[p.person.id] = {
                    lat: originLat,
                    lng: originLng,
                    isDisplaced: false
                };

                // Clear state for this key (will start fresh next time)
                // Actually, if a 2nd person comes, we want this person to stay 0?
                // Yes. So assign index 0.
                nextClusterState[key] = {};
                nextClusterState[key][p.person.id] = 0;
            } else {
                // Cluster
                const activePeople = cluster.map(c => c.person);
                // Cluster: Sort by YearFrom to stabilize order
                cluster.sort((a, b) => {
                    const yA = parseInt(a.person.yearFrom) || 0;
                    const yB = parseInt(b.person.yearFrom) || 0;
                    if (yA !== yB) return yA - yB;
                    return a.person.id.localeCompare(b.person.id);
                });

                cluster.forEach((item, index) => {
                    // Pass total count for circle calculation
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
                if (oldLatLng.distanceTo(newLatLng) > 1) {
                    marker.setLatLng(newLatLng);
                }
            } else {
                const marker = L.marker(newLatLng, {
                    icon: createCalloutIcon(person)
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
                } else {
                    const line = L.polyline(linePoints, {
                        color: '#666',
                        weight: 1,
                        opacity: 0.6
                    }).addTo(map);
                    displacementLines[person.id] = line;
                }
            } else {
                // Remove line if exists (no longer displaced)
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
                // Animate zoom
                map.fitBounds(bounds, { padding: [100, 100], animate: true, duration: 1 });
            }
        }
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
        updateMap(parseInt(slider.value));

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

    // Start
    loadData();
});
