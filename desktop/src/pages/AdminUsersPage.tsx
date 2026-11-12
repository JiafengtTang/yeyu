import { useCallback, useEffect, useState } from 'react'
import {
  ROLE_LABEL,
  USER_STATUSES,
  USER_STATUS_LABEL,
  type GroupDTO,
  type ListResult,
  type Role,
  type UserDTO,
  type UserStatus
} from '@yeyu/shared'
import { api, apiErrorMessage, formatDateTime } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, useToast } from '../ui'

const PAGE_SIZE = 10

const STATUS_TONE: Record<UserStatus, 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  DISABLED: 'danger'
}

export default function AdminUsersPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<UserDTO[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'' | UserStatus>('')
  const [groupFilter, setGroupFilter] = useState('')
  const [groups, setGroups] = useState<GroupDTO[]>([])
  const [groupModal, setGroupModal] = useState<{ mode: 'create' | 'rename'; target?: GroupDTO; name: string; description: string } | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<UserDTO | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetSubmitting, setResetSubmitting] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [result, groupList] = await Promise.all([
        api<ListResult<UserDTO>>('/api/users', {
          query: {
            status: status || undefined,
            q: keyword || undefined,
            groupId: groupFilter || undefined,
            page,
            pageSize: PAGE_SIZE
          }
        }),
        api<ListResult<GroupDTO>>('/api/groups')
      ])
      setItems(result.items)
      setTotal(result.total)
      setGroups(groupList.items)
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [status, groupFilter, keyword, page, toast])

  useEffect(() => {
    void load()
  }, [load])

  function applyKeyword(): void {
    setKeyword(keywordInput.trim())
    setPage(1)
  }

  function resetFilters(): void {
    setKeywordInput('')
    setKeyword('')
    setStatus('')
    setGroupFilter('')
    setPage(1)
  }

  function blockSelf(target: UserDTO): boolean {
    if (me && target.id === me.id) {
      toast.push('不能修改自己的角色或状态，请让其他管理员操作', 'error')
      return true
    }
    return false
  }

  async function updateUser(
    target: UserDTO,
    payload: { role?: Role; status?: UserStatus; groupId?: string | null },
    message: string
  ): Promise<void> {
    setBusyId(target.id)
    try {
      await api<UserDTO>('/api/users/' + target.id, { method: 'PATCH', body: payload })
      toast.push(message, 'success')
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  function openReset(target: UserDTO): void {
    setResetPassword('')
    setResetTarget(target)
  }

  async function submitReset(): Promise<void> {
    if (!resetTarget) return
    if (resetPassword.length < 6) {
      toast.push('新密码至少 6 位', 'error')
      return
    }
    setResetSubmitting(true)
    try {
      await api<{ ok: boolean }>('/api/users/' + resetTarget.id + '/reset-password', {
        method: 'POST',
        body: { password: resetPassword }
      })
      toast.push('密码已重置', 'success')
      setResetTarget(null)
      setResetPassword('')
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setResetSubmitting(false)
    }
  }

  async function saveGroup(): Promise<void> {
    if (!groupModal) return
    const name = groupModal.name.trim()
    if (!name) {
      toast.push('请填写小组名称', 'error')
      return
    }
    const description = groupModal.description.trim()
    setGroupBusy(true)
    try {
      if (groupModal.mode === 'create') {
        await api<GroupDTO>('/api/groups', { method: 'POST', body: { name, description: description || undefined } })
        toast.push('已新建小组「' + name + '」', 'success')
      } else if (groupModal.target) {
        await api<GroupDTO>('/api/groups/' + groupModal.target.id, {
          method: 'PATCH',
          body: { name, description: description || null }
        })
        toast.push('小组已更新', 'success')
      }
      setGroupModal(null)
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setGroupBusy(false)
    }
  }

  async function removeGroup(group: GroupDTO): Promise<void> {
    const ok = window.confirm(
      '删除小组「' + group.name + '」？组内 ' + group.memberCount + ' 名成员会回到未分组，账号本身不会被删除。'
    )
    if (!ok) return
    setGroupBusy(true)
    try {
      await api<{ ok: boolean }>('/api/groups/' + group.id, { method: 'DELETE' })
      toast.push('小组已删除', 'success')
      if (groupFilter === group.id) setGroupFilter('')
      await load()
    } catch (err) {
      toast.push(apiErrorMessage(err), 'error')
    } finally {
      setGroupBusy(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <>
      <div className="page-head">
        <div>
          <h2>用户与权限</h2>
          <p className="muted">审批注册申请、调整角色与账号状态、重置登录密码。</p>
        </div>
      </div>

      <Card
        title="小组管理"
        extra={
          <Button
            className="btn-sm"
            variant="primary"
            onClick={() => setGroupModal({ mode: 'create', name: '', description: '' })}
          >
            新建小组
          </Button>
        }
      >
        {groups.length === 0 ? (
          <p className="muted">还没有小组。可按研究方向或职能建组，再把成员归入组内。</p>
        ) : (
          <div className="group-list">
            {groups.map((group) => (
              <div className="group-row" key={group.id}>
                <span className="group-name">{group.name}</span>
                <span className="group-count">{group.memberCount} 人</span>
                {group.description ? <span className="group-desc">{group.description}</span> : null}
                <div className="group-actions">
                  <Button
                    className="btn-sm btn-ghost"
                    onClick={() => setGroupModal({ mode: 'rename', target: group, name: group.name, description: group.description ?? '' })}
                  >
                    重命名
                  </Button>
                  <Button
                    className="btn-sm btn-ghost icon-action-danger-text"
                    loading={groupBusy}
                    onClick={() => void removeGroup(group)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="账号列表" extra={<span className="muted">共 {total} 个账号</span>}>
        <div className="toolbar">
          <div className="grow">
            <Input
              value={keywordInput}
              onChange={(event) => setKeywordInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyKeyword()
              }}
              placeholder="搜索姓名或手机号"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as '' | UserStatus)
              setPage(1)
            }}
          >
            <option value="">全部状态</option>
            {USER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {USER_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
          <Select
            value={groupFilter}
            onChange={(event) => {
              setGroupFilter(event.target.value)
              setPage(1)
            }}
            aria-label="小组筛选"
          >
            <option value="">全部小组</option>
            <option value="NONE">未分组</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}（{group.memberCount}）
              </option>
            ))}
          </Select>
          <Button onClick={applyKeyword}>查询</Button>
          <Button variant="ghost" onClick={resetFilters}>
            重置
          </Button>
        </div>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="没有符合条件的账号" description="换个关键词或状态再试一次。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>手机号</th>
                  <th>邮箱</th>
                  <th>小组</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((target) => (
                  <tr key={target.id}>
                    <td>
                      {target.name}
                      {me && target.id === me.id ? (
                        <>
                          {' '}
                          <Badge tone="info">本人</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{target.phone}</td>
                    <td>{target.email ?? '-'}</td>
                    <td>
                      <Select
                        className="select-sm"
                        value={target.groupId ?? ''}
                        disabled={busyId === target.id}
                        onChange={(event) => {
                          const next = event.target.value || null
                          const label = next ? groups.find((g) => g.id === next)?.name ?? '小组' : '未分组'
                          void updateUser(target, { groupId: next }, target.name + ' 已归入「' + label + '」')
                        }}
                      >
                        <option value="">未分组</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td>
                      <Badge tone={target.role === 'ADMIN' ? 'info' : 'default'}>{ROLE_LABEL[target.role]}</Badge>
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[target.status]}>{USER_STATUS_LABEL[target.status]}</Badge>
                    </td>
                    <td>{formatDateTime(target.createdAt)}</td>
                    <td>
                      <div className="table-actions">
                        {target.status === 'ACTIVE' ? (
                          <Button
                            variant="danger"
                            className="btn-sm"
                            loading={busyId === target.id}
                            onClick={() => {
                              if (blockSelf(target)) return
                              void updateUser(target, { status: 'DISABLED' }, '账号已禁用')
                            }}
                          >
                            禁用
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            className="btn-sm"
                            loading={busyId === target.id}
                            onClick={() => {
                              if (blockSelf(target)) return
                              void updateUser(target, { status: 'ACTIVE' }, target.status === 'PENDING' ? '已审批通过' : '账号已启用')
                            }}
                          >
                            {target.status === 'PENDING' ? '审批通过' : '启用'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="btn-sm"
                          loading={busyId === target.id}
                          onClick={() => {
                            if (blockSelf(target)) return
                            const nextRole: Role = target.role === 'ADMIN' ? 'MEMBER' : 'ADMIN'
                            void updateUser(target, { role: nextRole }, nextRole === 'ADMIN' ? '已设为管理员' : '已设为成员')
                          }}
                        >
                          {target.role === 'ADMIN' ? '设为成员' : '设为管理员'}
                        </Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => openReset(target)}>
                          重置密码
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pager">
          <span>
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="toolbar">
            <Button variant="ghost" className="btn-sm" disabled={page <= 1} onClick={() => setPage((prev) => Math.max(1, prev - 1))}>
              上一页
            </Button>
            <Button
              variant="ghost"
              className="btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              下一页
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={resetTarget !== null}
        title={'重置密码 · ' + (resetTarget?.name ?? '')}
        onClose={() => setResetTarget(null)}
        footer={
          <>
            <Button onClick={() => setResetTarget(null)}>取消</Button>
            <Button variant="primary" loading={resetSubmitting} onClick={() => void submitReset()}>
              确认重置
            </Button>
          </>
        }
      >
        <Field label="新密码" required hint="至少 6 位，重置后请提醒本人立即修改">
          <Input
            type="password"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
            placeholder="请输入新密码"
            autoComplete="new-password"
          />
        </Field>
        <p className="muted">目标账号：{resetTarget?.phone ?? ''}</p>
      </Modal>

      <Modal
        open={groupModal !== null}
        title={groupModal?.mode === 'rename' ? '重命名小组' : '新建小组'}
        onClose={() => setGroupModal(null)}
        footer={
          <>
            <Button onClick={() => setGroupModal(null)}>取消</Button>
            <Button variant="primary" loading={groupBusy} onClick={() => void saveGroup()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="小组名称" required hint="例如：熔池监测组、工艺组、仿真组">
          <Input
            value={groupModal?.name ?? ''}
            maxLength={32}
            onChange={(event) => setGroupModal((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
            placeholder="请输入小组名称"
          />
        </Field>
        <Field label="说明" hint="可选，最多 100 字">
          <Input
            value={groupModal?.description ?? ''}
            maxLength={100}
            onChange={(event) => setGroupModal((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
            placeholder="例如：负责声发射监测与状态辨识"
          />
        </Field>
      </Modal>
    </>
  )
}
