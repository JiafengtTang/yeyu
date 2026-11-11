import { useEffect, useState } from 'react'
import { formatMoney, type AssetDTO, type BorrowDTO } from '@lab/shared'
import { api, apiErrorMessage } from '../../api/client'
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '../../ui'
import type { OwnerOption } from './shared'

interface Props {
  asset: AssetDTO | null
  owners: OwnerOption[]
  isAdmin: boolean
  currentUserId: string
  onClose(): void
  onDone(): void
}

export function BorrowModal({ asset, owners, isAdmin, currentUserId, onClose, onDone }: Props) {
  const toast = useToast()
  const [borrowerId, setBorrowerId] = useState(currentUserId)
  const [dueAt, setDueAt] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!asset) return
    setBorrowerId(currentUserId)
    setDueAt('')
    setNote('')
  }, [asset, currentUserId])

  async function handleSubmit(): Promise<void> {
    if (!asset) return
    setSaving(true)
    try {
      await api<BorrowDTO>('/api/assets/' + asset.id + '/borrow', {
        method: 'POST',
        body: {
          borrowerId: isAdmin ? borrowerId || undefined : undefined,
          dueAt: dueAt || undefined,
          note: note.trim() || undefined
        }
      })
      toast.push('借用登记成功', 'success')
      onDone()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={asset !== null}
      title={'借用登记' + (asset ? ' · ' + asset.code : '')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={() => void handleSubmit()}>
            确认借用
          </Button>
        </>
      }
    >
      {asset ? (
        <>
          <p className="muted">
            {asset.name} · 金额 {formatMoney(asset.amount)} · 当前状态 {asset.status}
          </p>
          <Field label="借用人">
            <Select
              value={borrowerId}
              disabled={!isAdmin}
              onChange={(event) => setBorrowerId(event.target.value)}
            >
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="预计归还日期">
            <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </Field>
          <Field label="备注">
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </>
      ) : null}
    </Modal>
  )
}
