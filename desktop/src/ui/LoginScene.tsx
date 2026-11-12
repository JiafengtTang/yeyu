import bgUrl from '../assets/login-bg.jpg'

// 登录页背景场景：真实照片 + 多层动效（推镜 / 星空闪烁 / 流星 / 雾气）
export function LoginScene() {
  return (
    <div className="login-scene" aria-hidden="true">
      <img className="login-bg" src={bgUrl} alt="" />
      <div className="login-stars login-stars-a" />
      <div className="login-stars login-stars-b" />
      <div className="login-meteor login-meteor-a" />
      <div className="login-meteor login-meteor-b" />
      <div className="login-mist" />
      <div className="login-tint" />
    </div>
  )
}
