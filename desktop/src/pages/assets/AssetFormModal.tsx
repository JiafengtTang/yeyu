import { useEffect, useState } from 'react'
import {
  ASSET_CATEGORY_SUGGESTIONS,
  ASSET_STATUSES,
  ASSET_STATUS_LABEL,
  type AssetDTO,
  type AssetInput,
  type AssetStatus
} from '@lab/shared'
import { api, apiErrorMessage } from '../../api/client'
import { Button, Field, Input, Modal, Select, Textarea, useToast } from '../../ui'
import { AssetAttachments } from './AssetAttachments'
import type { OwnerOption } from './shared'

interface FormState {
  code: string
  name: string
  category: string
  model: string
  serialNo: string
  quantity: string
  unitPrice: string
  amount: string
  purchaseDate: string
  supplier: string
  location: string
  ownerId: string
  status: AssetStatus
  remark: string
}

function emptyForm(ownerId: string): FormState {
  return {
    code: '',
    name: '',
    category: ASSET_CATEGORY_SUGGESTIONS[0],
    model: '',
    serialNo: '',
    quantity: '1',
    unitPrice: '',
    amount: '',
    purchaseDate: '',
    supplier: '',
    location: '',
    ownerId,
    status: 'IN_USE',
    remark: ''
  }
}

function fromAsset(asset: AssetDTO): FormState {
  return {
    code: asset.code,
    name: asset.name,
    category: asset.category,
    model: asset.model ?? '',
    serialNo: asset.serialNo ?? '',
    quantity: String(asset.quantity),
    unitPrice: asset.unitPrice === null ? '' : String(asset.unitPrice),
    amount: asset.amount === null ? '' : String(asset.amount),
    purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : '',
    supplier: asset.supplier ?? '',
    location: asset.location ?? '',
    ownerId: asset.ownerId ?? '',
    status: asset.status,
    remark: asset.remark ?? ''
  }
}

interface Props {
  open: boolean
  asset: AssetDTO | null
  owners: OwnerOption[]
  isAdmin: boolean
  currentUserId: string
  onClose(): void
  onSaved(asset: AssetDTO): void
}

export function AssetFormModal({ open, asset, owners, isAdmin, currentUserId, onClose, onSaved }: Props) {
  const toast = useToast()
  const [form, setForm] = useState<FormState>(() => emptyForm(currentUserId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(asset ? fromAsset(asset) : emptyForm(currentUserId))
    setError('')
  }, [open, asset, currentUserId])

  function update(patch: Partial<FormState>): void {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function buildPayload(): AssetInput | null {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) {
      setError('资产编码与名称必填')
      return null
    }
    const quantity = Number(form.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('数量必须是大于 0 的整数')
      return null
    }
    const unitPrice = form.unitPrice.trim() === '' ? undefined : Number(form.unitPrice)
    if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      setError('单价必须是不小于 0 的数字')
      return null
    }
    const amount = form.amount.trim() === '' ? undefined : Number(form.amount)
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      setError('金额必须是不小于 0 的数字')
      return null
    }
    return {
      code,
      name,
      category: form.category.trim() || ASSET_CATEGORY_SUGGESTIONS[0],
      model: form.model.trim() || undefined,
      serialNo: form.serialNo.trim() || undefined,
      quantity,
      unitPrice,
      amount,
      purchaseDate: form.purchaseDate || undefined,
      supplier: form.supplier.trim() || undefined,
      location: form.location.trim() || undefined,
      ownerId: isAdmin ? form.ownerId || undefined : undefined,
      status: form.status,
      remark: form.remark.trim() || undefined
    }
  }

  async function handleSubmit(): Promise<void> {
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      const saved = asset
        ? await api<AssetDTO>('/api/assets/' + asset.id, { method: 'PATCH', body: payload })
        : await api<AssetDTO>('/api/assets', { method: 'POST', body: payload })
      toast.push(asset ? '资产已更新' : '资产已创建', 'success')
      onSaved(saved)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const categories: string[] =
    form.category && !(ASSET_CATEGORY_SUGGESTIONS as readonly string[]).includes(form.category)
      ? [form.category, ...ASSET_CATEGORY_SUGGESTIONS]
      : [...ASSET_CATEGORY_SUGGESTIONS]

  return (
    <Modal
      open={open}
      title={asset ? '编辑资产 · ' + asset.code : '新建资产'}
      onClose={onClose}
      width={760}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={saving} onClick={() => void handleSubmit()}>
            保存
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="资产编码" required>
          <Input value={form.code} onChange={(event) => update({ code: event.target.value })} placeholder="例如 AST-0001" />
        </Field>
        <Field label="资产名称" required>
          <Input value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="例如 数字示波器" />
        </Field>
        <Field label="类别" required>
          <Select value={form.category} onChange={(event) => update({ category: event.target.value })}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="状态">
          <Select value={form.status} onChange={(event) => update({ status: event.target.value as AssetStatus })}>
            {ASSET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ASSET_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="型号">
          <Input value={form.model} onChange={(event) => update({ model: event.target.value })} />
        </Field>
        <Field label="序列号">
          <Input value={form.serialNo} onChange={(event) => update({ serialNo: event.target.value })} />
        </Field>
        <Field label="数量">
          <Input type="number" min={1} step={1} value={form.quantity} onChange={(event) => update({ quantity: event.target.value })} />
        </Field>
        <Field label="单价">
          <Input type="number" min={0} step="0.01" value={form.unitPrice} onChange={(event) => update({ unitPrice: event.target.value })} />
        </Field>
        <Field label="金额" hint="留空时按 单价 × 数量 计算">
          <Input type="number" min={0} step="0.01" value={form.amount} onChange={(event) => update({ amount: event.target.value })} />
        </Field>
        <Field label="购置日期">
          <Input type="date" value={form.purchaseDate} onChange={(event) => update({ purchaseDate: event.target.value })} />
        </Field>
        <Field label="供应商">
          <Input value={form.supplier} onChange={(event) => update({ supplier: event.target.value })} />
        </Field>
        <Field label="存放位置">
          <Input value={form.location} onChange={(event) => update({ location: event.target.value })} />
        </Field>
        <Field label="责任人" hint={isAdmin ? '管理员可指定任意成员' : '成员默认由自己负责'}>
          <Select
            value={form.ownerId}
            disabled={!isAdmin}
            onChange={(event) => update({ ownerId: event.target.value })}
          >
            {owners.length === 0 ? <option value={form.ownerId}>自己</option> : null}
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="备注" >
          <Textarea value={form.remark} onChange={(event) => update({ remark: event.target.value })} />
        </Field>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      {asset ? (
        <AssetAttachments key={asset.id} assetId={asset.id} initial={asset.attachments} canEdit />
      ) : (
        <p className="muted">保存后可继续上传附件（照片 / 发票 / 合同）。</p>
      )}
    </Modal>
  )
}
