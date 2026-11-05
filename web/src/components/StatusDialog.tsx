import { useState } from 'react';
import { companyApi, type CompanyStatus } from '../api';
import { Banner, Dialog, StatusChip, statusLabel, useAction, useMeta } from './ui';

type Props = {
  company: { domain: string; name: string; status: CompanyStatus };
  to: CompanyStatus;
  override?: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
};

// One dialog for every manual status change. The server enforces the rules; the dialog explains them
// up front and shows the server's message when a rule blocks the change.
export const StatusDialog = ({ company, to, override, onClose, onDone }: Props) => {
  const meta = useMeta().data;
  const { run, busy } = useAction();
  const [reason, setReason] = useState('');
  const needsReason = override || (meta?.reasonRequired as string[] | undefined)?.includes(to);
  const disabled = busy || (needsReason && reason.trim().length < 3);

  const confirm = async () => {
    const result = await run(() => companyApi.status(company.domain, to, reason, override), {
      success: `${company.name}: ${statusLabel(company.status)} → ${statusLabel(to)}. Gravado no histórico.`,
      reload: [onDone],
    });
    if (result) onClose();
  };

  return (
    <Dialog label="Mudar status da empresa" onClose={onClose}>
      <h2 className="h" style={{ fontSize: 17 }}>
        Mover {company.name} para <StatusChip status={to} />
      </h2>
      <div className="mt">
        {override
          ? 'Saída de Não contatar por override: só para Inativa, com motivo. A empresa não volta para nenhuma fila de envio.'
          : `${statusLabel(company.status)} → ${statusLabel(to)} é uma transição permitida pelo fluxo de status.`}
      </div>
      {to === 'qualified' && (
        <Banner color="bl">
          Qualificada exige ao menos um fato <b>verificado</b> de modelo de negócio. A qualificação é recalculada e gravada ao confirmar.
        </Banner>
      )}
      {to === 'do_not_contact' && (
        <Banner color="dr" icon="warn">
          <b>Irreversível na prática.</b> Não contatar bloqueia todo envio. Só é possível voltar para Inativa por override, com motivo.
        </Banner>
      )}
      {needsReason && (
        <label className="lb">
          Motivo (obrigatório)
          <textarea className="in" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: porte acima de 50 funcionários" />
        </label>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="bt" onClick={onClose}>
          Cancelar
        </button>
        <button className="bt p" disabled={disabled} onClick={confirm}>
          Registrar mudança
        </button>
      </div>
    </Dialog>
  );
};
