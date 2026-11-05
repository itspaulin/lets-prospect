import { type DuplicateGroup, useApi } from '../api';
import { Chip, ErrorBox, Flag, Loading, StatusChip } from '../components/ui';
import { brDateTime, utcLabel } from '../format';
import { Link } from '../router';

const ROWS: Array<[string, (company: DuplicateGroup['companies'][number]) => React.ReactNode]> = [
  ['Domínio', (company) => <span className="mono">{company.domain}</span>],
  ['Status', (company) => <StatusChip status={company.status} />],
  ['País', (company) => (
    <>
      <Flag country={company.country} />
      {company.country}
      {company.region ? ` · ${company.region}` : ''}
    </>
  )],
  ['Funcionários', (company) => company.employeeCount ?? '—'],
  ['Tecnologias', (company) => company.technologies.join(', ') || '—'],
  ['Fonte', (company) => company.source ?? '—'],
  ['Cadastrada em', (company) => <span title={utcLabel(company.createdAt)}>{brDateTime(company.createdAt, true)}</span>],
];

export const DuplicatesPage = () => {
  const { data, error, reload } = useApi<DuplicateGroup[]>('/api/companies/duplicates');
  return (
    <>
      <div>
        <Link className="mt" to="/empresas">
          ← Empresas
        </Link>
        <h1 className="t">Possíveis duplicadas</h1>
        <div className="sub">Empresas com nome parecido ou com um domínio que é subdomínio de outro. O domínio idêntico já é bloqueado no cadastro.</div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <Loading />}
      {data?.length === 0 && (
        <section className="cd">
          <div className="cdb mt">Nenhuma possível duplicada encontrada.</div>
        </section>
      )}
      {data?.map((group) => (
        <section className="cd" key={group.companies[0]!.id}>
          <div className="cdh">
            <h2 className="h">{group.companies.map((company) => company.name).join(' × ')}</h2>
            {[...new Set(group.reasons.map((item) => item.reason))].map((reason) => (
              <Chip key={reason} color="am" dot={false}>
                {reason}
              </Chip>
            ))}
          </div>
          <div className="tbw" style={{ border: 0, borderRadius: 0 }}>
            <table className="tb">
              <thead>
                <tr>
                  <th scope="col" />
                  {group.companies.map((company) => (
                    <th scope="col" key={company.id}>
                      <Link className="nm" to={`/empresas/${company.domain}`}>
                        {company.name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, render]) => (
                  <tr key={label}>
                    <td className="mt">{label}</td>
                    {group.companies.map((company) => (
                      <td key={company.id}>{render(company)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cdb mt">
            Nada é mesclado automaticamente. Se forem a mesma empresa, mantenha a que tem mais histórico e mova a outra para <span className="mono">disqualified</span> com o
            motivo “duplicada de …”.
          </div>
        </section>
      ))}
    </>
  );
};
