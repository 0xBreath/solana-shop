import { getAssociatedTokenAddress } from '@solana/spl-token';
import { useConnection } from '@solana/wallet-adapter-react';
import {
    LAMPORTS_PER_SOL,
    ParsedConfirmedTransaction,
    PublicKey,
    Connection,
    RpcResponseAndContext,
    SignatureStatus,
    TransactionSignature,
} from '@solana/web3.js';
import BigNumber from 'bignumber.js';
import React, { FC, ReactNode, useEffect, useState } from 'react';
import { useConfig } from '../../hooks/useConfig';
import { Transaction, TransactionsContext } from '../../hooks/useTransactions';
import { Confirmations } from '../../types';
import { arraysEqual } from '../../utils/arraysEqual';
import { MAX_CONFIRMATIONS, MAINNET_ENDPOINT } from '../../utils/constants';
import { usePayment } from '../../hooks/usePayment'

export interface TransactionsProviderProps {
    children: ReactNode;
    pollInterval?: number;
}

export const TransactionsProvider: FC<TransactionsProviderProps> = ({ children, pollInterval }) => {
    pollInterval ||= 10000;

    const { connection } = useConnection();
    const { 
        recipient
    } = useConfig();
    const {
        splToken
    } = usePayment();
    const [associatedToken, setAssociatedToken] = useState<PublicKey>();
    const [signatures, setSignatures] = useState<TransactionSignature[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(false);

    // Get the ATA for the recipient and token
    useEffect(() => {
        if (!splToken) return;

        let changed = false;

        (async () => {
            const associatedToken = await getAssociatedTokenAddress(splToken, recipient);
            if (changed) return;

            setAssociatedToken(associatedToken);
        })();

        return () => {
            changed = true;
            setAssociatedToken(undefined);
        };
    }, [splToken, recipient]);

    // Poll for signatures referencing the associated token account
    useEffect(() => {
        let changed = false;

        const run = async () => {
            try {
                setLoading(true);

                const confirmedSignatureInfos = await connection.getSignaturesForAddress(
                    associatedToken || recipient,
                    { limit: 10 },
                    'confirmed'
                );
                if (changed) return;

                setSignatures((prevSignatures) => {
                    const nextSignatures = confirmedSignatureInfos.map(({ signature }) => signature);
                    return arraysEqual(prevSignatures, nextSignatures) ? prevSignatures : nextSignatures;
                });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (error: any) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };

        const interval = setInterval(run, 5000);
        void run();

        return () => {
            changed = true;
            clearInterval(interval);
            setSignatures([]);
        };
    }, [connection, associatedToken, recipient]);

    // When the signatures change, poll and update the transactions
    useEffect(() => {
        if (!signatures.length) return;
        let changed = false;

        const run = async () => {
            let parsedConfirmedTransactions: (ParsedConfirmedTransaction | null)[],
                signatureStatuses: RpcResponseAndContext<(SignatureStatus | null)[]>;
            try {
                setLoading(true);

                [parsedConfirmedTransactions, signatureStatuses] = await Promise.all([
                    connection.getParsedConfirmedTransactions(signatures),
                    connection.getSignatureStatuses(signatures, { searchTransactionHistory: true }),
                ]);
            } catch (error) {
                if (changed) return;
                console.error(error);
                return;
            } finally {
                setLoading(false);
            }
            if (changed) return;

            setTransactions(
                signatures
                    .map((signature, signatureIndex): Transaction | undefined => {
                        const parsedConfirmedTransaction = parsedConfirmedTransactions[signatureIndex];
                        const signatureStatus = signatureStatuses.value[signatureIndex];
                        if (!parsedConfirmedTransaction?.meta || !signatureStatus) return;

                        const feePayer = parsedConfirmedTransaction
                        .transaction
                        .message
                        .accountKeys[0]
                        .pubkey;

                        const timestamp = parsedConfirmedTransaction.blockTime;
                        const error = parsedConfirmedTransaction.meta.err;
                        const status = signatureStatus.confirmationStatus;
                        if (!timestamp || !status) return;

                        if (parsedConfirmedTransaction.transaction.message.instructions.length !== 1) return;
                        const instruction = parsedConfirmedTransaction.transaction.message.instructions[0];
                        if (!('program' in instruction)) return;
                        const program = instruction.program;
                        const type = instruction.parsed?.type;
                        const info = instruction.parsed.info;

                        let preAmount: BigNumber, postAmount: BigNumber;
                        if (!associatedToken) {
                            // Include only SystemProgram.transfer instructions
                            if (!(program === 'system' && type === 'transfer')) return;

                            // Include only transfers to the recipient
                            if (info?.destination !== recipient.toBase58()) return;

                            // Exclude self-transfers
                            if (info.source === recipient.toBase58()) return;

                            const accountIndex = parsedConfirmedTransaction.transaction.message.accountKeys.findIndex(
                                ({ pubkey }) => pubkey.equals(recipient)
                            );
                            if (accountIndex === -1) return;

                            const preBalance = parsedConfirmedTransaction.meta.preBalances[accountIndex];
                            const postBalance = parsedConfirmedTransaction.meta.postBalances[accountIndex];

                            preAmount = new BigNumber(preBalance).div(LAMPORTS_PER_SOL);
                            postAmount = new BigNumber(postBalance).div(LAMPORTS_PER_SOL);
                        } else {
                            // Include only TokenProgram.transfer / TokenProgram.transferChecked instructions
                            if (!(program === 'spl-token' && (type === 'transfer' || type === 'transferChecked')))
                                return;

                            // Include only transfers to the recipient ATA
                            if (info?.destination !== associatedToken.toBase58()) return;

                            // Exclude self-transfers
                            if (info.source === associatedToken.toBase58()) return;

                            const accountIndex = parsedConfirmedTransaction.transaction.message.accountKeys.findIndex(
                                ({ pubkey }) => pubkey.equals(associatedToken)
                            );
                            if (accountIndex === -1) return;

                            const preBalance = parsedConfirmedTransaction.meta.preTokenBalances?.find(
                                (x) => x.accountIndex === accountIndex
                            );
                            if (!preBalance?.uiTokenAmount.uiAmountString) return;

                            const postBalance = parsedConfirmedTransaction.meta.postTokenBalances?.find(
                                (x) => x.accountIndex === accountIndex
                            );
                            if (!postBalance?.uiTokenAmount.uiAmountString) return;

                            preAmount = new BigNumber(preBalance.uiTokenAmount.uiAmountString);
                            postAmount = new BigNumber(postBalance.uiTokenAmount.uiAmountString);
                        }

                        // Exclude negative amounts
                        if (postAmount.lt(preAmount)) return;

                        const amount = postAmount.minus(preAmount).toString();
                        const confirmations =
                            status === 'finalized'
                                ? MAX_CONFIRMATIONS
                                : ((signatureStatus.confirmations || 0) as Confirmations);

                        return {
                            feePayer,
                            signature,
                            amount,
                            timestamp,
                            error,
                            status,
                            confirmations,
                        };
                    })
                    .filter((transaction): transaction is Transaction => !!transaction)
            );
        };

        const interval = setInterval(run, pollInterval);
        void run();

        return () => {
            changed = true;
            clearInterval(interval);
        };
    }, [signatures, connection, associatedToken, recipient, pollInterval]);

    return <TransactionsContext.Provider value={{ transactions, loading }}>{children}</TransactionsContext.Provider>;
};
