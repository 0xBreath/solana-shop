
const anchor = require("@project-serum/anchor");
import { programs } from '@metaplex/js';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MintLayout,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Token } from '@solana/spl-token';
import { web3, Provider } from '@project-serum/anchor';

const { Metadata, MetadataDataData, CreateMetadata, Creator } =
    programs.metadata;

export async function createMint(
    connection: web3.Connection,
    fee_payer: Keypair,
    dest_owner: PublicKey,
) {
    const mint = Keypair.generate();
    console.log(mint.publicKey.toString());

    const tx_mint = new web3.Transaction();
    let ata = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID, // always associated token program id
        TOKEN_PROGRAM_ID, // always token program id
        mint.publicKey, // mint
        dest_owner // token account authority,
    );

    const mintRent = await connection.getMinimumBalanceForRentExemption(
        MintLayout.span,
    );

    tx_mint.add(
        // create mint
        SystemProgram.createAccount({
            fromPubkey: fee_payer.publicKey,
            newAccountPubkey: mint.publicKey,
            space: MintLayout.span,
            lamports: mintRent,
            programId: TOKEN_PROGRAM_ID,
        }),
        Token.createInitMintInstruction(
            TOKEN_PROGRAM_ID,
            mint.publicKey,
            0,
            fee_payer.publicKey,
            fee_payer.publicKey
        ),
        // create token account
        Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            mint.publicKey,
            ata,
            dest_owner,
            fee_payer.publicKey
        ),
        // mint to token account
        Token.createMintToInstruction(
            TOKEN_PROGRAM_ID,
            mint.publicKey,
            ata,
            fee_payer.publicKey,
            [],
            1
        )
    );

    const metadataPDA = await Metadata.getPDA(mint.publicKey);
    const metadataData = new MetadataDataData({
        name: "Creature #0",
        symbol: "AURAH",
        uri: `localhost:3000/${mint.publicKey.toString()}/metadata?d=orc&c=class&s=1&h=1`,
        sellerFeeBasisPoints: 500,
        creators: [
            new Creator({
                address: fee_payer.publicKey.toString(),
                verified: true,
                share: 100,
            }),
        ],
    });
    const tx_metadata = new CreateMetadata(
        {
            feePayer: fee_payer.publicKey,
        },
        {
            metadata: metadataPDA,
            metadataData,
            updateAuthority: fee_payer.publicKey,
            mint: mint.publicKey,
            mintAuthority: fee_payer.publicKey,
        }
    );
    tx_mint.add(tx_metadata);
    await connection.sendTransaction(tx_mint, [fee_payer, mint])
}


//const provider = anchor.Provider.local("https://api.mainnet-beta.solana.com");
const provider = anchor.Provider.local("https://api.devnet.solana.com");
//const provider = anchor.Provider.local("http://127.0.0.1:8899")
anchor.setProvider(provider);

(async () => {
    try {
        await createMint(provider.connection, anchor.Wallet.local().payer, anchor.Wallet.local().publicKey);
    } catch (e) {
        console.log(e)
    }
})();
