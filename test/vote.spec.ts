import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import * as crypto from 'crypto';
import { Oracle } from '../scripts/Oracle';
import {
  blind, unBlind, messageToHashInt,
} from '../scripts/rsablind';

describe('Vote', () => {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;

  const ballot = [0];
  const userSecret = 'top secret e';
  let userKeys: crypto.KeyPairSyncResult<string, string>;
  let encryptedBallot: Buffer;
  let blindedMessage: BigInteger;
  let privateKey: BigInteger;
  let signature: BigInteger;
  let unBlindedSignature: BigInteger;
  let encryptedBallotHex: string;

  const oracle = new Oracle();

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    userKeys = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: userSecret,
      },
    });

    encryptedBallot = crypto.publicEncrypt({
      key: userKeys.publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(ballot));

    const blindResult = blind({
      message: encryptedBallot,
      modulus: oracle.modulus,
      exponent: oracle.exponent,
    });

    blindedMessage = blindResult.blindedMessage;
    privateKey = blindResult.privateKey;
    signature = oracle.singBallot(blindedMessage);

    unBlindedSignature = unBlind({
      signature,
      modulus: oracle.modulus,
      privateKey,
    });

    encryptedBallotHex = encryptedBallot.toString('hex');
  });

  it('should push ballot', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const ballotIndex = ethers.BigNumber.from(result.value).toNumber();

    await expect(ballotIndex).to.be.equal(0);
  });

  it('should push ballot private key and decrypted data', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const ballotIndex = ethers.BigNumber.from(result.value).toNumber();

    const privateKeyHex = Buffer.from(userKeys.privateKey, 'utf8').toString('hex');

    await contract.pushBallotPrivateKey(ballotIndex, `0x${privateKeyHex}`);

    const ballotResult = await contract.ballots(0);
    const encryptedValueBallot: string = ballotResult.encryptedValue;
    const privateKeyBallot: string = ballotResult.privateKey;

    const decryptedData = crypto.privateDecrypt(
      {
        key: Buffer.from(privateKeyBallot.slice(2, privateKeyBallot.length), 'hex').toString('utf8'),
        passphrase: userSecret,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      Buffer.from(encryptedValueBallot.slice(2, encryptedValueBallot.length), 'hex'),
    );

    expect(Array.from<number>(decryptedData)).deep.equal(ballot);
  });

  it('should return ballots array length', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const ballotsArrayLength = ethers.BigNumber.from(
      await contract.getBallotCount(),
    ).toNumber();
    expect(ballotsArrayLength).to.be.equal(1);
  });

  it('should return verified signature array length', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const verifiedSignatureArrayLength = ethers.BigNumber.from(
      await contract.getVerifiedSignatureCount(),
    ).toNumber();
    expect(verifiedSignatureArrayLength).to.be.equal(1);
  });

  it('should return candidates array length', async () => {
    const contract = await oracle.createTestVoting(owner);
    const candidatesArrayLength = ethers.BigNumber.from(
      await contract.getCandidateCount(),
    ).toNumber();
    expect(candidatesArrayLength).to.be.equal(oracle.candidates.length);
  });

  it('should throw an error end date of voting must be later than start date', async () => {
    const startDate = Math.round(Date.now() / 1000);
    await expect(
      oracle.createTestVoting(owner, false, startDate, startDate - 120),
    ).to.be.revertedWith('End date of voting must be later than start date');
  });

  it('should throw an error signature has already been used to vote', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    await expect(
      contract.pushBallot(
        '0x0001',
        messageToHashInt(encryptedBallot).toString(),
        unBlindedSignature.toString(),
      ),
    ).to.be.revertedWith('Signature has already been used to vote');
  });

  it('should throw an error you are not the ballot owner', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const ballotIndex = ethers.BigNumber.from(result.value).toNumber();

    const privateKeyHex = Buffer.from(userKeys.privateKey, 'utf8').toString('hex');

    await contract.pushBallotPrivateKey(ballotIndex, `0x${privateKeyHex}`);

    await expect(
      contract.connect(user).pushBallotPrivateKey(ballotIndex, `0x${privateKeyHex}`),
    ).to.be.revertedWith('You are not the ballot owner');
  });

  it('should throw an error private key already set', async () => {
    const contract = await oracle.createTestVoting(owner);

    const result = await contract.pushBallot(
      `0x${encryptedBallotHex}`,
      messageToHashInt(encryptedBallot).toString(),
      unBlindedSignature.toString(),
    );

    const ballotIndex = ethers.BigNumber.from(result.value).toNumber();

    const privateKeyHex = Buffer.from(userKeys.privateKey, 'utf8').toString('hex');

    await contract.pushBallotPrivateKey(ballotIndex, `0x${privateKeyHex}`);

    await expect(
      contract.pushBallotPrivateKey(ballotIndex, `0x${privateKeyHex}`),
    ).to.be.revertedWith('Private key already set');
  });

  it('should throw an error voting has not started', async () => {
    const startDate = Math.round(Date.now() / 1000) + 3600;
    const contract = await oracle.createTestVoting(owner, false, startDate);

    await expect(
      contract.pushBallot(
        `0x${encryptedBallotHex}`,
        messageToHashInt(encryptedBallot).toString(),
        unBlindedSignature.toString(),
      ),
    ).to.be.revertedWith('Voting has not started');
  });

  it('should throw an error voting is over', async () => {
    const startDate = Math.round(Date.now() / 1000) - 3600;
    const contract = await oracle.createTestVoting(owner, false, startDate, startDate + 1800);

    await expect(
      contract.pushBallot(
        `0x${encryptedBallotHex}`,
        messageToHashInt(encryptedBallot).toString(),
        unBlindedSignature.toString(),
      ),
    ).to.be.revertedWith('Voting is over');
  });

  it('should throw an error signature not verified', async () => {
    const startDate = Math.round(Date.now() / 1000) - 3600;
    const contract = await oracle.createTestVoting(owner, false, startDate, startDate + 1800);

    await expect(
      contract.pushBallot(
        `0x${encryptedBallotHex}`,
        messageToHashInt(encryptedBallot).toString(),
        '1234567',
      ),
    ).to.be.revertedWith('Signature not verified');
  });
});