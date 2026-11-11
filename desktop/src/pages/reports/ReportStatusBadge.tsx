import type { ReportStatus } from '@lab/shared'
import { REPORT_STATUS_LABEL } from '@lab/shared'
import { Badge } from '../../ui'

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info'

const TONE: Record<ReportStatus, Tone> = {
  DRAFT: 'default',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger'
}

export function ReportStatusBadge({ status, late = false }: { status: ReportStatus; late?: boolean }) {
  return (
    <>
      <Badge tone={TONE[status] ?? 'default'}>{REPORT_STATUS_LABEL[status] ?? status}</Badge>
      {late ? (
        <>
          {' '}
          <Badge tone="warning">迟交</Badge>
        </>
      ) : null}
    </>
  )
}
