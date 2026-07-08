// SPDX-License-Identifier: MIT
let networkNodes = [];
let networkEdges = [];
let networkAnimFrame = null;

// Token selector state
let selectedTokens = new Set();
let selectedPoolAddr = null;

const GENESIS_NODE_COLOR = '#fbbf24'; // gold for genesis tokens
const KNOWN_TOKEN_COLOR = '#34d399';  // green for known tokens
const PROVENANCE_POOL_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308'];

async function fetchProvenanceChain() {
  if (!state.factoryAddr) return null;
  try {
    const eth = window.ethereum;
    if (!eth) return null;
    const prov = new ethers.BrowserProvider(eth);
    const f = new ethers.Contract(state.factoryAddr, FACTORY_ABI, prov);
    const result = await f.getApostolicChain();
    const genesisTokens = await f.getGenesisTokens();
    return {
      poolCount: Number(result[0]),
      poolTokens: result[1],
      genesis: genesisTokens,
    };
  } catch (e) {
    console.warn('Provenance fetch failed:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
//  TOKEN SELECTOR — Autocomplete for single pool graph
// ══════════════════════════════════════════════════════════

function getCurrentPool() {
  const poolGroups = state.pools.length > 0 ? state.pools : 
    (state.TOKENS.length > 0 && state.poolCache.tvwapK ? [{
      poolAddr: state.poolAddr,
      TOKENS: state.TOKENS,
      LP_ADDR: state.LP_ADDR,
      LP_SYMBOL: state.LP_SYMBOL,
      LP_DECIMALS: state.LP_DECIMALS,
      poolCache: state.poolCache,
    }] : []);
  
  return poolGroups.find(p =>
    p.poolAddr && (state.activePoolAddr || state.poolAddr) &&
    p.poolAddr.toLowerCase() === (state.activePoolAddr || state.poolAddr).toLowerCase()
  ) || (poolGroups.length === 1 ? poolGroups[0] : null);
}

function initTokenSelector() {
  const searchInput = $('token-search');
  const dropdown = $('token-dropdown');
  
  if (!searchInput || !dropdown) return;
  
  // Autocomplete input handler
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    const pool = getCurrentPool();
    if (!pool) return;
    
    if (query.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    
    // Filter tokens by query
    const matches = pool.TOKENS.filter(t =>
      t.sym.toLowerCase().includes(query) ||
      t.sym.toLowerCase().includes(query) ||
      t.addr.toLowerCase().includes(query)
    );
    
    renderDropdown(matches, dropdown, query);
    dropdown.style.display = matches.length > 0 ? 'block' : 'none';
  });
  
  // Click outside closes dropdown
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

function renderDropdown(tokens, dropdown, query) {
  dropdown.innerHTML = '';
  
  tokens.slice(0, 20).forEach(t => {
    const item = document.createElement('div');
    item.className = 'token-dropdown-item';
    
    const highlight = t.sym.replace(
      new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<strong>${m}</strong>`
    );
    
    item.innerHTML = `
      <span class="token-symbol">${highlight}</span>
      <span class="token-name">${t.sym}</span>
      <span class="token-address">${t.addr.slice(0, 6)}...${t.addr.slice(-4)}</span>
    `;
    
    item.addEventListener('click', () => selectToken(t, dropdown));
    dropdown.appendChild(item);
  });
}

function selectToken(token, dropdown) {
  const pool = getCurrentPool();
  if (!pool) return;
  
  selectedTokens.add(token.addr.toLowerCase());
  selectedPoolAddr = pool.poolAddr;
  
  $('token-search').value = token.sym;
  dropdown.style.display = 'none';
  
  buildTokenGraph(token, pool);
}

function clearTokenSelection() {
  selectedTokens.clear();
  selectedPoolAddr = null;
  $('token-search').value = '';
  $('token-dropdown').style.display = 'none';
  
  if (networkAnimFrame) {
    cancelAnimationFrame(networkAnimFrame);
    networkAnimFrame = null;
  }
  
  const canvas = $('network-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  networkNodes = [];
  networkEdges = [];
}

// ══════════════════════════════════════════════════════════
//  MULTI-POOL TOKEN GRAPH
// ══════════════════════════════════════════════════════════

function buildTokenGraph(seedToken, sourcePool) {
  const canvas = $('network-canvas');
  if (!canvas) return;
  
  // Gather all pools that contain this token
  const pools = gatherPoolsForToken(seedToken.addr.toLowerCase(), sourcePool);
  if (pools.length === 0) return;
  
  networkNodes = [];
  networkEdges = [];
  
  // Build graph from gathered pools
  buildProvenanceGraph(pools);
  
  // Start physics simulation
  startPhysics(canvas);
}

function gatherPoolsForToken(tokenAddr, sourcePool) {
  const result = [];
  const seen = new Set();
  
  // Always include the source pool
  if (sourcePool) {
    result.push(sourcePool);
    seen.add(sourcePool.poolAddr.toLowerCase());
  }
  
  // Scan all pools for shared tokens
  for (const pool of state.pools) {
    if (seen.has(pool.poolAddr.toLowerCase())) continue;
    
    const hasToken = pool.TOKENS.some(t =>
      t.addr.toLowerCase() === tokenAddr
    );
    
    if (hasToken) {
      result.push(pool);
      seen.add(pool.poolAddr.toLowerCase());
    }
  }
  
  // BFS depth limit to prevent runaway
  const MAX_DEPTH = 3;
  let frontier = result.map(p => p.poolAddr.toLowerCase());
  
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const nextFrontier = [];
    
    for (const pool of state.pools) {
      if (seen.has(pool.poolAddr.toLowerCase())) continue;
      
      // Check if this pool shares a token with any frontier pool
      const poolTokenAddrs = new Set(pool.TOKENS.map(t => t.addr.toLowerCase()));
      const shares = frontier.some(fAddr => {
        const fPool = state.pools.find(p => p.poolAddr.toLowerCase() === fAddr);
        return fPool && fPool.TOKENS.some(ft => poolTokenAddrs.has(ft.addr.toLowerCase()));
      });
      
      if (shares) {
        result.push(pool);
        seen.add(pool.poolAddr.toLowerCase());
        nextFrontier.push(pool.poolAddr.toLowerCase());
        
        if (result.length >= 50) break; // Hard cap
      }
    }
    
    frontier = nextFrontier;
    if (frontier.length === 0) break;
    if (result.length >= 50) break;
  }
  
  return result;
}

function buildProvenanceGraph(pools) {
  const nodeMap = new Map();
  const nodeColors = {};
  const genesisTokenAddrs = new Set();
  const genesisData = window.__genesisChain || null;
  
  // Process genesis tokens
  if (genesisData && genesisData.genesis) {
    for (const g of genesisData.genesis) {
      genesisTokenAddrs.add(g.toLowerCase());
    }
  }
  
  // Track shared token counts for pool positioning
  const poolTokenMap = new Map();
  
  // Create token nodes
  for (const pool of pools) {
    for (const token of pool.TOKENS) {
      const addr = token.addr.toLowerCase();
      
      if (!nodeMap.has(addr)) {
        // Determine color
        let color = PROVENANCE_POOL_COLORS[pools.indexOf(pool) % PROVENANCE_POOL_COLORS.length];
        
        if (genesisTokenAddrs.has(addr)) {
          color = GENESIS_NODE_COLOR;
        }
        
        nodeMap.set(addr, {
          id: addr,
          label: token.sym,
          name: token.sym,
          color: color,
          isGenesis: genesisTokenAddrs.has(addr),
          poolCount: 1,
          x: Math.random() * 800,
          y: Math.random() * 600,
          vx: 0,
          vy: 0,
          radius: genesisTokenAddrs.has(addr) ? 12 : 8,
        });
      } else {
        nodeMap.get(addr).poolCount++;
        // Increase radius for shared tokens
        nodeMap.get(addr).radius = Math.min(8 + nodeMap.get(addr).poolCount * 2, 20);
      }
      
      // Track pool->tokens
      if (!poolTokenMap.has(pool.poolAddr)) {
        poolTokenMap.set(pool.poolAddr, []);
      }
      poolTokenMap.get(pool.poolAddr).push(addr);
    }
  }
  
  // Create edges between tokens that share a pool
  for (const [poolAddr, tokenAddrs] of poolTokenMap) {
    for (let i = 0; i < tokenAddrs.length; i++) {
      for (let j = i + 1; j < tokenAddrs.length; j++) {
        const edgeId = `${tokenAddrs[i]}-${tokenAddrs[j]}`;
        const edgeIdReverse = `${tokenAddrs[j]}-${tokenAddrs[i]}`;
        
        const exists = networkEdges.some(e => e.id === edgeId || e.id === edgeIdReverse);
        if (!exists) {
          networkEdges.push({
            id: edgeId,
            source: tokenAddrs[i],
            target: tokenAddrs[j],
            poolAddr: poolAddr,
            weight: 1,
          });
        } else {
          // Increase weight for multiple pool connections
          const edge = networkEdges.find(e => e.id === edgeId || e.id === edgeIdReverse);
          if (edge) edge.weight++;
        }
      }
    }
  }
  
  networkNodes = Array.from(nodeMap.values());
  
  // Add click handler for node interaction
  const canvas = document.getElementById('network-canvas');
  if (canvas && !canvas._clickBound) {
    canvas._clickBound = true;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scale = canvas.width / rect.width;
      const cx = mx * scale;
      const cy = my * scale;
      
      for (const node of networkNodes) {
        const dx = cx - node.x;
        const dy = cy - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= node.radius + 4) {
          if (node.poolAddr) {
            document.getElementById('pool-addr').value = node.poolAddr;
            if (typeof connectToPool === 'function') connectToPool(node.poolAddr);
          } else if (node.isToken && node.poolAddrs && node.poolAddrs.length > 0) {
            document.getElementById('pool-addr').value = node.poolAddrs[0];
            if (typeof connectToPool === 'function') connectToPool(node.poolAddrs[0]);
          }
          break;
        }
      }
    });
    
    // Hover tooltip
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const scale = canvas.width / rect.width;
      const cx = mx * scale;
      const cy = my * scale;
      
      let hovered = null;
      for (const node of networkNodes) {
        const dx = cx - node.x;
        const dy = cy - node.y;
        if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
          hovered = node;
          break;
        }
      }
      
      const tooltip = document.getElementById('network-tooltip');
      if (hovered && tooltip) {
        tooltip.classList.add('visible');
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY - 20) + 'px';
        document.getElementById('tt-title').textContent = hovered.label;
        let content = '';
        if (hovered.poolAddr) content += `<div class="tt-row"><span>Pool</span><span class="val">${hovered.poolAddr.slice(0, 10)}...</span></div>`;
        if (hovered.tokenCount) content += `<div class="tt-row"><span>Assets</span><span class="val">${hovered.tokenCount}</span></div>`;
        document.getElementById('tt-content').innerHTML = content;
        canvas.style.cursor = 'pointer';
      } else if (tooltip) {
        tooltip.classList.remove('visible');
        canvas.style.cursor = 'default';
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
//  PHYSICS SIMULATION (force-directed layout)
// ══════════════════════════════════════════════════════════

function startPhysics(canvas) {
  if (networkAnimFrame) {
    cancelAnimationFrame(networkAnimFrame);
  }
  
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth;
  const H = canvas.height = 600;
  
  // Physics constants
  const REPULSION = 8000;
  const ATTRACTION = 0.005;
  const DAMPING = 0.9;
  const CENTER_GRAVITY = 0.01;
  const MIN_VELOCITY = 0.1;
  const MAX_ITERATIONS = 300;
  
  let iteration = 0;
  
  function simulate() {
    // Calculate forces
    for (let i = 0; i < networkNodes.length; i++) {
      let fx = 0, fy = 0;
      
      // Repulsion between all nodes
      for (let j = 0; j < networkNodes.length; j++) {
        if (i === j) continue;
        
        const dx = networkNodes[i].x - networkNodes[j].x;
        const dy = networkNodes[i].y - networkNodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const force = REPULSION / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
      
      // Attraction along edges
      for (const edge of networkEdges) {
        let other = null;
        if (edge.source === networkNodes[i].id) {
          other = networkNodes.find(n => n.id === edge.target);
        } else if (edge.target === networkNodes[i].id) {
          other = networkNodes.find(n => n.id === edge.source);
        }
        
        if (other) {
          const dx = other.x - networkNodes[i].x;
          const dy = other.y - networkNodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          
          const force = ATTRACTION * (dist - 100) * edge.weight;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }
      
      // Center gravity
      fx += (W / 2 - networkNodes[i].x) * CENTER_GRAVITY;
      fy += (H / 2 - networkNodes[i].y) * CENTER_GRAVITY;
      
      // Update velocities
      networkNodes[i].vx = (networkNodes[i].vx + fx) * DAMPING;
      networkNodes[i].vy = (networkNodes[i].vy + fy) * DAMPING;
      
      // Apply velocities
      networkNodes[i].x += networkNodes[i].vx;
      networkNodes[i].y += networkNodes[i].vy;
      
      // Boundary clamping
      networkNodes[i].x = Math.max(networkNodes[i].radius, Math.min(W - networkNodes[i].radius, networkNodes[i].x));
      networkNodes[i].y = Math.max(networkNodes[i].radius, Math.min(H - networkNodes[i].radius, networkNodes[i].y));
    }
    
    iteration++;
    
    // Check if settled
    const totalSpeed = networkNodes.reduce((sum, n) => sum + Math.abs(n.vx) + Math.abs(n.vy), 0);
    const settled = totalSpeed < MIN_VELOCITY * networkNodes.length || iteration >= MAX_ITERATIONS;
    
    renderGraph(ctx, W, H);
    
    if (!settled) {
      networkAnimFrame = requestAnimationFrame(simulate);
    } else {
      // One final render at settled position
      renderGraph(ctx, W, H);
    }
  }
  
  simulate();
}

function renderGraph(ctx, W, H) {
  ctx.clearRect(0, 0, W, H);
  
  // Draw edges
  for (const edge of networkEdges) {
    const source = networkNodes.find(n => n.id === edge.source);
    const target = networkNodes.find(n => n.id === edge.target);
    if (!source || !target) continue;
    
    const alpha = Math.min(edge.weight / 3, 1);
    ctx.strokeStyle = `rgba(100, 116, 139, ${alpha})`;
    ctx.lineWidth = Math.min(edge.weight, 4);
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  }
  
  // Draw nodes
  for (const node of networkNodes) {
    // Highlight active pool node
    if (node.poolAddr && state.activePoolAddr && node.poolAddr.toLowerCase() === state.activePoolAddr.toLowerCase()) {
      ctx.strokeStyle = '#3dcf8e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Outer glow for genesis tokens
    if (node.isGenesis) {
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.radius * 2);
      gradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
      gradient.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Node body
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Label
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(node.label, node.x, node.y + node.radius + 14);
    
    // Pool count badge for shared tokens
    if (node.poolCount > 1) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px "Fira Code", monospace';
      ctx.fillText(`${node.poolCount}p`, node.x, node.y + node.radius + 26);
    }
  }
  
  // Legend
  const legendX = 16;
  const legendY = H - 60;
  
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(legendX - 8, legendY - 8, 180, 52);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX - 8, legendY - 8, 180, 52);
  
  // Genesis
  ctx.fillStyle = GENESIS_NODE_COLOR;
  ctx.beginPath();
  ctx.arc(legendX + 8, legendY + 10, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px "Fira Code", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Genesis token', legendX + 20, legendY + 14);
  
  // Pool
  ctx.fillStyle = PROVENANCE_POOL_COLORS[0];
  ctx.beginPath();
  ctx.arc(legendX + 8, legendY + 30, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText('Pool token', legendX + 20, legendY + 34);
}

// ══════════════════════════════════════════════════════════
//  POOL ORIGIN GRAPH — Multi-pool pool overview (alternative mode)
// ══════════════════════════════════════════════════════════

function renderPoolOriginGraph() {
  const canvas = $('network-canvas');
  if (!canvas) return;
  
  if (networkAnimFrame) {
    cancelAnimationFrame(networkAnimFrame);
  }
  
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth;
  const H = canvas.height = 600;
  
  // Gather pool data
  const poolNodes = [];
  const poolEdges = [];
  const tokenMap = new Map();
  
  for (const pool of state.pools) {
    const poolX = 100 + Math.random() * (W - 200);
    const poolY = 100 + Math.random() * (H - 200);
    
    poolNodes.push({
      id: pool.poolAddr,
      label: pool.LP_SYMBOL || pool.poolAddr.slice(0, 8),
      tokenCount: pool.TOKENS.length,
      tokens: pool.TOKENS,
      x: poolX,
      y: poolY,
      vx: 0,
      vy: 0,
      radius: Math.min(15 + pool.TOKENS.length * 3, 35),
    });
    
    // Track tokens across pools
    for (const token of pool.TOKENS) {
      const addr = token.addr.toLowerCase();
      if (!tokenMap.has(addr)) {
        tokenMap.set(addr, []);
      }
      tokenMap.get(addr).push(pool.poolAddr);
    }
  }
  
  // Create edges for shared tokens
  for (const [tokenAddr, poolAddrs] of tokenMap) {
    if (poolAddrs.length < 2) continue;
    
    for (let i = 0; i < poolAddrs.length; i++) {
      for (let j = i + 1; j < poolAddrs.length; j++) {
        const edgeId = `${poolAddrs[i]}-${poolAddrs[j]}`;
        if (!poolEdges.some(e => e.id === edgeId)) {
          poolEdges.push({
            id: edgeId,
            source: poolAddrs[i],
            target: poolAddrs[j],
            tokenAddr: tokenAddr,
          });
        }
      }
    }
  }
  
  networkNodes = poolNodes;
  networkEdges = poolEdges;
  startPhysics(canvas);
}
