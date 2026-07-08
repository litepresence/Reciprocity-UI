// SPDX-License-Identifier: MIT
(function() {
const AVALANCHE_NETWORKS = {
  fuji: {
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    factory: null,
    chainId: 43113,
    explorer: 'https://testnet.snowtrace.io',
  },
  mainnet: {
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    factory: null,
    chainId: 43114,
    explorer: 'https://snowtrace.io',
  },
};

window.chainAPI_avalanche = Object.assign(
  Object.create(window.chainAPI_evm),
  {
    name: 'Avalanche',
    logo: 'img/logos/avalanche.svg',
    defaultRpc: AVALANCHE_NETWORKS.fuji.rpc,
    defaultFactory: AVALANCHE_NETWORKS.fuji.factory,
    network: 'fuji',
    chainId: AVALANCHE_NETWORKS.fuji.chainId,
    explorer: AVALANCHE_NETWORKS.fuji.explorer,
    configs: AVALANCHE_NETWORKS,

    setNetwork(network) {
      const cfg = AVALANCHE_NETWORKS[network];
      if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(AVALANCHE_NETWORKS).join(', ')}`);
      this.defaultRpc = cfg.rpc;
      this.defaultFactory = cfg.factory;
      this.chainId = cfg.chainId;
      this.explorer = cfg.explorer;
      this.network = network;
      console.log(`%c[Avalanche] %cNetwork: ${network} (chain ${cfg.chainId})`, 'color:#888', 'color:#2d7cf0');
      console.log(`  RPC: ${cfg.rpc}`);
      console.log(`  Factory: ${cfg.factory || 'not set'}`);
      console.log(`  Explorer: ${cfg.explorer}`);
    },
  }
);
})();
