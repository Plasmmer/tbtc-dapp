// The script prepares and submits redemption transaction to bitcoin chain.
//
// Format:
// truffle exec demo/5_submit_redemption_transaction.js <DEPOSIT_ADDRESS>
//
// Arguments:
// DEPOSIT_ADDRESS - Address of Deposit contract instance
const ElectrumClient = require('tbtc-helpers').ElectrumClient
const electrumConfig = require('../../src/config/config.json')

const contracts = require('../src/eth/contracts')

const redemptionTransaction = require('../src/RedemptionTransaction')
const BN = require('bn.js')

module.exports = async function() {
  try {
    // Parse arguments
    const depositAddress = process.argv[4]

    let ECDSAKeep
    let TBTCSystem

    let depositLog
    let ecdsaKeep

    try {
      ECDSAKeep = contracts.ECDSAKeep
      TBTCSystem = contracts.TBTCSystem

      await contracts.setDefaults(web3)

      depositLog = await TBTCSystem.deployed()
    } catch (err) {
      console.error(`initialization failed: ${err}`)
      process.exit(1)
    }

    try {
      const depositCreatedEvents = await depositLog.getPastEvents('Created', {
        fromBlock: 0,
        toBlock: 'latest',
        filter: { _depositContractAddress: depositAddress },
      })

      const keepAddress = depositCreatedEvents[0].returnValues._keepAddress

      ecdsaKeep = await ECDSAKeep.at(keepAddress)
    } catch (err) {
      console.error(`failed to get keep: ${err}`)
      process.exit(1)
    }
    console.debug('keep address:', ecdsaKeep.address)

    const redemptionEvents = await depositLog.getPastEvents(
      'RedemptionRequested',
      {
        filter: { _depositContractAddress: depositAddress },
        fromBlock: 0,
        toBlock: 'latest',
      }
    ).catch((err) => {
      console.error(`failed to get past redemption requested events`)
      process.exit(1)
    })

    let latestRedemptionEvent
    if (redemptionEvents.length > 0) {
      latestRedemptionEvent = redemptionEvents[redemptionEvents.length - 1]
    } else {
      console.error(`redemption requested events list is empty`)
      process.exit(1)
    }
    console.debug('latest redemption requested event:', latestRedemptionEvent)

    let unsignedTransaction
    try {
      const utxoSize = new BN(latestRedemptionEvent.returnValues._utxoSize)
      const requesterPKH = Buffer.from(web3.utils.hexToBytes(latestRedemptionEvent.returnValues._requesterPKH))
      const requestedFee = new BN(latestRedemptionEvent.returnValues._requestedFee)
      const outpoint = Buffer.from(web3.utils.hexToBytes(latestRedemptionEvent.returnValues._outpoint))

      const outputValue = utxoSize.sub(requestedFee)

      unsignedTransaction = redemptionTransaction.oneInputOneOutputWitnessTX(
        outpoint,
        // We set sequence to `0` to be able to replace by fee. It reflects
        // bitcoin-spv https://github.com/summa-tx/bitcoin-spv/blob/2a9d594d9b14080bdbff2a899c16ffbf40d62eef/solidity/contracts/CheckBitcoinSigs.sol#L154
        0,
        outputValue,
        requesterPKH
      )
    } catch (err) {
      console.error(`failed to get unsigned transaction: ${err}`)
      process.exit(1)
    }

    console.debug('unsigned transaction:', unsignedTransaction)

    // Get keep public key
    let keepPublicKey
    try {
      const publickKeyEvents = await depositLog.getPastEvents(
        'RegisteredPubkey',
        {
          fromBlock: '0',
          toBlock: 'latest',
          filter: { _depositContractAddress: depositAddress },
        }
      )

      const publicKeyX = web3.utils.hexToBytes(publickKeyEvents[0].returnValues._signingGroupPubkeyX)
      const publicKeyY = web3.utils.hexToBytes(publickKeyEvents[0].returnValues._signingGroupPubkeyY)

      keepPublicKey = Buffer.concat([Buffer.from(publicKeyX), Buffer.from(publicKeyY)])
    } catch (err) {
      console.error(`failed to get public key: ${err}`)
      process.exit(1)
    }
    console.debug('keep public key:', keepPublicKey.toString('hex'))

    // Get signature calculated by keep
    let signatureR
    let signatureS
    try {
      const digest = Buffer.from(web3.utils.hexToBytes(latestRedemptionEvent.returnValues._digest))

      const signatureEvents = await ecdsaKeep.getPastEvents(
        'SignatureSubmitted',
        {
          fromBlock: '0',
          toBlock: 'latest',
          filter: { _digest: digest },
        }
      )

      if (signatureEvents.length == 0) {
        throw new Error('signatures list is empty')
      }

      signatureR = Buffer.from(web3.utils.hexToBytes(signatureEvents[0].returnValues.r))
      signatureS = Buffer.from(web3.utils.hexToBytes(signatureEvents[0].returnValues.s))

      console.debug('signature r:', signatureR.toString('hex'))
      console.debug('signature s:', signatureS.toString('hex'))
    } catch (err) {
      console.error(`failed to get signature: ${err}`)
      process.exit(1)
    }

    // Add witness signature to transaction
    let signedTransaction
    try {
      signedTransaction = redemptionTransaction.addWitnessSignature(
        unsignedTransaction,
        0,
        signatureR,
        signatureS,
        keepPublicKey
      )
    } catch (err) {
      console.error(`failed to add witness to transaction: ${err}`)
      process.exit(1)
    }
    console.debug('signed transaction:', signedTransaction)

    // Publish transaction to bitcoin chain
    try {
      const electrumClient = new ElectrumClient.Client(electrumConfig.electrum.testnetWS)
      await electrumClient.connect()

      const txHash = await electrumClient.broadcastTransaction(signedTransaction)

      console.log('redemption transaction submitted with hash:', txHash)
    } catch (err) {
      console.error(`failed to broadcast transaction: ${err}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
  process.exit()
}
