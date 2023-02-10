const withdrawals = require('./withdrawals')
const { newApp } = require('./dao')
const { artifacts } = require('hardhat')
const { deployLocatorWithDummyAddressesImplementation } = require('./locator-deploy')

const {
  SLOTS_PER_EPOCH,
  SECONDS_PER_SLOT,
  SECONDS_PER_FRAME,
  EPOCHS_PER_FRAME,
  CONSENSUS_VERSION
} = require('./constants')

const OssifiableProxy = artifacts.require('OssifiableProxy')
const LidoMock = artifacts.require('LidoMock')
const Lido = artifacts.require('Lido')
const WstETHMock = artifacts.require('WstETHMock')
const WstETH = artifacts.require('WstETH')
const LidoOracle = artifacts.require('LidoOracle')
const MockLegacyOracle = artifacts.require('MockLegacyOracle')
const AccountingOracle = artifacts.require('AccountingOracle')
const HashConsensus = artifacts.require('HashConsensus')
const HashConsensusTimeTravellable = artifacts.require('HashConsensusTimeTravellable')
const MockReportProcessor = artifacts.require('MockReportProcessor')
const StakingRouter = artifacts.require('StakingRouter')
const LidoExecutionLayerRewardsVault = artifacts.require('LidoExecutionLayerRewardsVault')
const WithdrawalVault = artifacts.require('WithdrawalVault')
const DepositContractMock = artifacts.require('DepositContractMock')
const DepositContract = artifacts.require('DepositContract')
const DepositSecurityModule = artifacts.require('DepositSecurityModule')
const EIP712StETH = artifacts.require('EIP712StETH')
const Burner = artifacts.require('Burner')
const OracleReportSanityChecker = artifacts.require('OracleReportSanityChecker')
const ValidatorsExitBusOracle = artifacts.require('ValidatorsExitBusOracle')

async function lidoMockFactory({ dao, appManager, acl, voting }) {
  const base = await LidoMock.new()

  const proxyAddress = await newApp(dao, 'lido', base.address, appManager.address)

  const pool = await LidoMock.at(proxyAddress)

  await grantLidoRoles(pool, acl, voting, appManager)

  return pool
}

async function grantLidoRoles(pool, acl, voting, appManager) {
  await Promise.all([
    acl.createPermission(voting.address, pool.address, await pool.PAUSE_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.RESUME_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.STAKING_PAUSE_ROLE(), appManager.address, {
      from: appManager.address
    }),
    acl.createPermission(voting.address, pool.address, await pool.STAKING_CONTROL_ROLE(), appManager.address, {
      from: appManager.address
    })
  ])
}

async function depositContractMockFactory(_) {
  return await DepositContractMock.new()
}

async function depositContractFactory(_) {
  return await DepositContract.new()
}

async function wstethFactory({ pool }) {
  return await WstETH.new(pool.address)
}

async function appManagerFactory({ signers }) {
  return signers[0]
}

async function votingEOAFactory({ signers }) {
  return signers[1]
}

async function treasuryFactory(_) {
  return web3.eth.accounts.create()
}

async function legacyOracleFactory({ appManager }) {
  const base = await LidoOracle.new()
  const proxy = await OssifiableProxy.new(base.address, appManager.address, '0x')
  return await LidoOracle.at(proxy.address)
}

async function legacyOracleMockFactory({ appManager, dao, deployParams }) {
  const base = await MockLegacyOracle.new()

  const proxyAddress = await newApp(dao, 'lido-legacy-oracle', base.address, appManager.address)

  const oracle = await MockLegacyOracle.at(proxyAddress)

  await oracle.setParams(
    EPOCHS_PER_FRAME,
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    deployParams.v1OracleLastCompletedEpoch
  )

  return oracle
}

async function reportProcessorFactory(_) {
  return await MockReportProcessor.new(CONSENSUS_VERSION)
}

async function hashConsensusFactory({ voting, oracle, signers, legacyOracle, deployParams }) {
  const initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensus.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    EPOCHS_PER_FRAME,
    initialEpoch,
    deployParams.hashConsensus.fastLaneLengthSlots,
    voting.address,
    oracle.address
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_FRAME_CONFIG_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_FAST_LANE_CONFIG_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), voting.address, { from: voting.address })

  await consensus.addMember(signers[2].address, 1, { from: voting.address })
  await consensus.addMember(signers[3].address, 2, { from: voting.address })
  await consensus.addMember(signers[4].address, 2, { from: voting.address })

  await oracle.initialize(voting.address, consensus.address, CONSENSUS_VERSION, 10000, 10000)

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_DATA_BOUNDARIES_ROLE(), voting.address, { from: voting.address })

  return consensus
}

async function hashConsensusTimeTravellableFactory({
  legacyOracle,
  voting,
  oracle,
  signers,
  deployParams,
  lidoLocator
}) {
  const initialEpoch = +(await legacyOracle.getLastCompletedEpochId()) + EPOCHS_PER_FRAME
  const consensus = await HashConsensusTimeTravellable.new(
    SLOTS_PER_EPOCH,
    SECONDS_PER_SLOT,
    deployParams.genesisTime,
    EPOCHS_PER_FRAME,
    initialEpoch,
    deployParams.hashConsensus.fastLaneLengthSlots,
    voting.address,
    oracle.address
  )

  await consensus.grantRole(await consensus.MANAGE_MEMBERS_AND_QUORUM_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.DISABLE_CONSENSUS_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_FRAME_CONFIG_ROLE(), voting.address, { from: voting.address })
  await consensus.grantRole(await consensus.MANAGE_REPORT_PROCESSOR_ROLE(), voting.address, { from: voting.address })

  await consensus.addMember(signers[2].address, 1, { from: voting.address })
  await consensus.addMember(signers[3].address, 2, { from: voting.address })
  await consensus.addMember(signers[4].address, 2, { from: voting.address })
  await consensus.setTime(deployParams.genesisTime + initialEpoch * SLOTS_PER_EPOCH * SECONDS_PER_SLOT)

  await oracle.initialize(
    voting.address,
    consensus.address,
    CONSENSUS_VERSION,
    10000,
    10000,
  )

  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_CONTRACT_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_CONSENSUS_VERSION_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.SUBMIT_DATA_ROLE(), voting.address, { from: voting.address })
  await oracle.grantRole(await oracle.MANAGE_DATA_BOUNDARIES_ROLE(), voting.address, { from: voting.address })

  return consensus
}

async function accountingOracleFactory({ voting, pool, lidoLocator, legacyOracle, deployParams }) {
  const base = await AccountingOracle.new(
    lidoLocator.address,
    pool.address,
    legacyOracle.address,
    SECONDS_PER_SLOT,
    deployParams.genesisTime
  )
  const proxy = await OssifiableProxy.new(base.address, voting.address, '0x')
  return await AccountingOracle.at(proxy.address)
}

async function withdrawalCredentialsFactory() {
  return '0x'.padEnd(66, '1234')
}

async function stakingRouterFactory({ depositContract, dao, appManager, voting, pool, withdrawalCredentials }) {
  const base = await StakingRouter.new(depositContract.address)

  const proxyAddress = await newApp(dao, 'lido-oracle', base.address, appManager.address)
  const stakingRouter = await StakingRouter.at(proxyAddress)
  await stakingRouter.initialize(appManager.address, pool.address, withdrawalCredentials, { from: appManager.address })

  const [
    MANAGE_WITHDRAWAL_CREDENTIALS_ROLE,
    STAKING_MODULE_PAUSE_ROLE,
    STAKING_MODULE_MANAGE_ROLE,
    REPORT_REWARDS_MINTED_ROLE
  ] = await Promise.all([
    stakingRouter.MANAGE_WITHDRAWAL_CREDENTIALS_ROLE(),
    stakingRouter.STAKING_MODULE_PAUSE_ROLE(),
    stakingRouter.STAKING_MODULE_MANAGE_ROLE(),
    stakingRouter.REPORT_REWARDS_MINTED_ROLE()
  ])
  await stakingRouter.grantRole(REPORT_REWARDS_MINTED_ROLE, pool.address, { from: appManager.address })

  await stakingRouter.grantRole(MANAGE_WITHDRAWAL_CREDENTIALS_ROLE, voting.address, { from: appManager.address })
  await stakingRouter.grantRole(STAKING_MODULE_PAUSE_ROLE, voting.address, { from: appManager.address })
  await stakingRouter.grantRole(STAKING_MODULE_MANAGE_ROLE, voting.address, { from: appManager.address })

  return stakingRouter
}

async function depositSecurityModuleFactory({
  pool,
  depositContract,
  stakingRouter,
  appManager,
  guardians,
  deployParams
}) {
  const depositSecurityModule = await DepositSecurityModule.new(
    pool.address,
    depositContract.address,
    stakingRouter.address,
    deployParams.maxDepositsPerBlock,
    deployParams.minDepositBlockDistance,
    deployParams.pauseIntentValidityPeriodBlocks,
    { from: appManager.address }
  )
  await depositSecurityModule.addGuardians(guardians.addresses, 2, { from: appManager.address })

  return depositSecurityModule
}

async function elRewardsVaultFactory({ pool, treasury }) {
  return await LidoExecutionLayerRewardsVault.new(pool.address, treasury.address)
}

async function withdrawalQueueFactory({ appManager, oracle, wsteth }) {
  const withdrawalQueue = (await withdrawals.deploy(appManager.address, wsteth.address)).queue

  await withdrawalQueue.initialize(
    appManager.address,
    appManager.address,
    appManager.address,
    appManager.address,
    appManager.address
  )

  const BUNKER_MODE_REPORT_ROLE = await withdrawalQueue.BUNKER_MODE_REPORT_ROLE()
  await withdrawalQueue.grantRole(BUNKER_MODE_REPORT_ROLE, oracle.address, { from: appManager.address })

  return withdrawalQueue
}

async function withdrawalVaultFactory({ pool, treasury }) {
  return await WithdrawalVault.new(pool.address, treasury.address)
}

async function eip712StETHFactory({ appManager }) {
  return await EIP712StETH.new({ from: appManager.address })
}

async function stakingModulesFactory(_) {
  return []
}

async function guardiansFactory({ deployParams }) {
  return {
    privateKeys: deployParams.guardians,
    addresses: Object.keys(deployParams.guardians)
  }
}

async function burnerFactory({ appManager, treasury, pool, voting }) {
  const burner = await Burner.new(appManager.address, treasury.address, pool.address, 0, 0)

  const [REQUEST_BURN_MY_STETH_ROLE, RECOVER_ASSETS_ROLE] = await Promise.all([
    burner.REQUEST_BURN_MY_STETH_ROLE(),
    burner.RECOVER_ASSETS_ROLE()
  ])

  await burner.grantRole(REQUEST_BURN_MY_STETH_ROLE, voting.address, { from: appManager.address })
  await burner.grantRole(RECOVER_ASSETS_ROLE, voting.address, { from: appManager.address })

  return burner
}

async function lidoLocatorFactory({appManager}) {
  return await deployLocatorWithDummyAddressesImplementation(appManager.address)
}

async function oracleReportSanityCheckerFactory({ lidoLocator, voting, appManager, deployParams }) {
  const checker = await OracleReportSanityChecker.new(
    lidoLocator.address,
    SECONDS_PER_FRAME,
    appManager.address,
    deployParams.oracleReportSanityChecker.limitsList,
    deployParams.oracleReportSanityChecker.managersRoster
  )

  await checker.grantRole(await checker.ALL_LIMITS_MANAGER_ROLE(), voting.address, { from: appManager.address })

  return checker
}

async function validatorExitBusFactory(protocol) {
  const base = await ValidatorsExitBusOracle.new(
    SECONDS_PER_SLOT,
    protocol.deployParams.genesisTime,
    protocol.lidoLocator.address
  )

  return await OssifiableProxy.new(base.address, protocol.appManager.address, '0x')
}

async function postSetup({
  pool,
  lidoLocator,
  eip712StETH,
  depositContract,
  withdrawalQueue,
  appManager,
  voting,
  deployParams,
  legacyOracle,
  consensusContract
}) {
  await pool.initialize(lidoLocator.address, eip712StETH.address)

  await legacyOracle.initialize(lidoLocator.address, consensusContract.address)

  await depositContract.reset()
  await depositContract.set_deposit_root(deployParams.depositRoot)
  await withdrawalQueue.updateBunkerMode(false, 0, { from: appManager.address })
  await pool.resumeProtocolAndStaking({ from: voting.address })
}

module.exports = {
  appManagerFactory,
  treasuryFactory,
  votingEOAFactory,
  depositContractFactory,
  lidoMockFactory,
  wstethFactory,
  accountingOracleFactory,
  depositContractMockFactory,
  stakingRouterFactory,
  depositSecurityModuleFactory,
  elRewardsVaultFactory,
  withdrawalQueueFactory,
  withdrawalVaultFactory,
  eip712StETHFactory,
  withdrawalCredentialsFactory,
  stakingModulesFactory,
  guardiansFactory,
  burnerFactory,
  postSetup,
  legacyOracleFactory,
  legacyOracleMockFactory,
  hashConsensusFactory,
  hashConsensusTimeTravellableFactory,
  reportProcessorFactory,
  lidoLocatorFactory,
  oracleReportSanityCheckerFactory,
  validatorExitBusFactory
}
