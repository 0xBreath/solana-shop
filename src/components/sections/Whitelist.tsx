import React, { FC } from 'react';
import { usePayment } from '../../hooks/usePayment';
import * as css from './Whitelist.module.pcss';

export const Whitelist: FC = () => {
    const { collection, whitelist } = usePayment();

    const onClick = () => {
        whitelist();
    }

    return (
        <div className={css.root}>
            <form
            onSubmit={onClick}
            className={css.root}
            >
                <div className={css.root}>
                    <label className={css.total}>
                    </label>
                    
                    <textarea
                    rows={1}
                    className={css.form}
                    >
                        Enter NFT mint from collection to whitelist
                    </textarea>
                </div>
            </form>
      </div>
    )
};
