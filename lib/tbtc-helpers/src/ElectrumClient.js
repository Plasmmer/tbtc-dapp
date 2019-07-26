const ElectrumCli = require('electrum-client')

function Config(server, port, protocol) {
  this.server = server,
  this.port = port,
  this.protocol = protocol
}

class Client {
  constructor(config) {
    this.electrumCli = new ElectrumCli(config.port, config.server, config.protocol)
  }

  async connect() {
    try {
      await this.electrumCli.connect()

      const banner = await this.electrumCli.server_banner()
      console.log(banner)
    } catch (err) {
      return Promise.reject(new Error(`failed to connect to electrum server: [${err}]`))
    }
  }

  async close() {
    this.electrumCli.close()
  }

  async latestBlockHeight() {
    const header = await this.electrumCli.blockchainHeaders_subscribe()
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })
    return header.height
  }

  async getTransaction(txHash) {
    const tx = await this.electrumCli.blockchainTransaction_get(txHash, true)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })

    return tx
  }

  async getMerkleRoot(blockHeight) {
    const header = await this.electrumCli.blockchainBlock_header(blockHeight)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })

    return fromHex(header).slice(36, 68)
  }

  async getHeadersChain(blockHeight, confirmations) {
    const headersChain = await this.electrumCli.blockchainBlock_headers(blockHeight, confirmations + 1)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })
    return headersChain.hex
  }

  async getMerkleProof(txHash, blockHeight) {
    const merkle = await this.electrumCli.blockchainTransaction_getMerkle(txHash, blockHeight)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })

    const position = merkle.pos + 1 // add 1 because proof uses 1-indexed positions

    // Transaction hash
    let proof = fromHex(txHash).reverse()

    // Merkle tree
    merkle.merkle.forEach(function(item) {
      proof = Buffer.concat([proof, fromHex(item).reverse()])
    })

    // Merkle root
    const merkleRoot = await this.getMerkleRoot(blockHeight)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })

    proof = Buffer.concat([proof, fromHex(merkleRoot)])

    return { proof: toHex(proof), position: position }
  }

  async findOutputForAddress(txHash, address) {
    const tx = await this.getTransaction(txHash)
      .catch((err) => {
        return Promise.reject(new Error(JSON.stringify(err)))
      })

    return new Promise((resolve, reject) => {
      const outputs = tx.vout

      for (let index = 0; index < outputs.length; index++) {
        for (const a of outputs[index].scriptPubKey.addresses) {
          if (a == address) {
            resolve(index)
          }
        }
      }

      reject(new Error(`output for address ${address} not found`))
    })
  }

  watchHeaders() {
    // TODO: Leaving this snippet for later to find the example easily
    //
    // client.subscribe.on('blockchain.headers.subscribe', (v) => {
    //   console.log('emitted', v)
    // }) // subscribe message(EventEmitter)
  }
}

function fromHex(hex) {
  return Buffer.from(hex, 'hex')
}

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

module.exports = {
  Config, Client,
}
