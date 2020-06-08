import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DefaultDialogFooter,
} from './dialog'
import {
  dialogTransitionEnterTimeout,
  dialogTransitionLeaveTimeout,
} from './app'
import { GitError } from '../lib/git/core'
import { GitError as GitErrorType } from 'dugite'
import { Popup, PopupType } from '../models/popup'
import { CSSTransitionGroup } from 'react-transition-group'
import { OkCancelButtonGroup } from './dialog/ok-cancel-button-group'
import { ErrorWithMetadata } from '../lib/error-with-metadata'
import { RetryActionType, RetryAction } from '../models/retry-actions'
import { Ref } from './lib/ref'

interface IAppErrorProps {
  /** The list of queued, app-wide, errors  */
  readonly errors: ReadonlyArray<Error>

  /**
   * A callback which is used whenever a particular error
   * has been shown to, and been dismissed by, the user.
   */
  readonly onClearError: (error: Error) => void
  readonly onShowPopup: (popupType: Popup) => void | undefined
  readonly onRetryAction: (retryAction: RetryAction) => void
}

interface IAppErrorState {
  /** The currently displayed error or null if no error is shown */
  readonly error: Error | null

  /**
   * Whether or not the dialog and its buttons are disabled.
   * This is used when the dialog is transitioning out of view.
   */
  readonly disabled: boolean
}

/**
 * A component which renders application-wide errors as dialogs. Only one error
 * is shown per dialog and if multiple errors are queued up they will be shown
 * in the order they were queued.
 */
export class AppError extends React.Component<IAppErrorProps, IAppErrorState> {
  private dialogContent: HTMLDivElement | null = null

  public constructor(props: IAppErrorProps) {
    super(props)
    this.state = {
      error: props.errors[0] || null,
      disabled: false,
    }
  }

  public componentWillReceiveProps(nextProps: IAppErrorProps) {
    const error = nextProps.errors[0] || null

    // We keep the currently shown error until it has disappeared
    // from the first spot in the application error queue.
    if (error !== this.state.error) {
      this.setState({ error, disabled: false })
    }
  }

  private onDismissed = () => {
    const currentError = this.state.error

    if (currentError) {
      this.setState({ error: null, disabled: true })

      // Give some time for the dialog to nicely transition
      // out before we clear the error and, potentially, deal
      // with the next error in the queue.
      window.setTimeout(() => {
        this.props.onClearError(currentError)
      }, dialogTransitionLeaveTimeout)
    }
  }

  private showPreferencesDialog = () => {
    this.onDismissed()

    //This is a hacky solution to resolve multiple dialog windows
    //being open at the same time.
    window.setTimeout(() => {
      this.props.onShowPopup({ type: PopupType.Preferences })
    }, dialogTransitionLeaveTimeout)
  }

  private renderErrorWithMetaDataFooter(error: ErrorWithMetadata) {
    const { retryAction } = error.metadata
    if (retryAction !== undefined) {
      if (retryAction.type === RetryActionType.Clone) {
        return this.renderRetryCloneFooter(retryAction)
      }
    }

    if (isGitError(error.underlyingError)) {
      return this.renderGitErrorFooter(error.underlyingError)
    }

    return this.renderDefaultFooter()
  }

  private renderRetryCloneFooter(retryAction: RetryAction) {
    let retryTitle = 'Retry'

    if (this.isCloneError) {
      retryTitle = __DARWIN__ ? 'Retry Clone' : 'Retry clone'
    }

    return (
      <DialogFooter>
        <OkCancelButtonGroup
          okButtonText={retryTitle}
          onOkButtonClick={this.onRetryAction}
          onCancelButtonClick={this.onCloseButtonClick}
        />
      </DialogFooter>
    )
  }

  private onRetryAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    this.onDismissed()

    if (this.state.error && isErrorWithMetaData(this.state.error)) {
      const { retryAction } = this.state.error.metadata
      if (retryAction !== undefined) {
        this.props.onRetryAction(retryAction)
      }
    }
  }

  private renderGitErrorFooter(error: GitError) {
    const gitErrorType = error.result.gitError

    switch (gitErrorType) {
      case GitErrorType.HTTPSAuthenticationFailed: {
        return (
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Close"
              onOkButtonClick={this.onCloseButtonClick}
              cancelButtonText={
                __DARWIN__ ? 'Open Preferences' : 'Open options'
              }
              onCancelButtonClick={this.showPreferencesDialog}
            />
          </DialogFooter>
        )
      }
      default:
        return this.renderDefaultFooter()
    }
  }

  private renderDefaultFooter() {
    return <DefaultDialogFooter onButtonClick={this.onCloseButtonClick} />
  }

  private renderErrorMessage(error: Error) {
    let monospace = false
    const e = error instanceof ErrorWithMetadata ? error.underlyingError : error

    if (e instanceof GitError) {
      // See getResultMessage in core.ts
      // If the error message is the same as stderr or stdout then we know
      // it's output from git and we'll display it in fixed-width font
      if (e.message === e.result.stderr || e.message === e.result.stdout) {
        monospace = true
      }
    }

    const className = monospace ? 'monospace' : undefined

    return <p className={className}>{e.message}</p>
  }

  private get isCloneError() {
    const e = this.state.error
    if (e !== null && isErrorWithMetaData(e)) {
      if (
        e.metadata.retryAction !== undefined &&
        e.metadata.retryAction.type === RetryActionType.Clone
      ) {
        return true
      }
    }

    return false
  }

  private getTitle() {
    if (this.isCloneError) {
      return `Clone failed`
    }

    return 'Error'
  }

  private renderDialog() {
    const error = this.state.error

    if (!error) {
      return null
    }

    return (
      <Dialog
        id="app-error"
        type="error"
        key="error"
        title={this.getTitle()}
        dismissable={false}
        onSubmit={this.onDismissed}
        onDismissed={this.onDismissed}
        disabled={this.state.disabled}
      >
        <DialogContent onRef={this.onDialogContentRef}>
          {this.renderErrorMessage(error)}
          {this.renderContentAfterErrorMessage(error)}
        </DialogContent>
        {this.renderFooter(error)}
      </Dialog>
    )
  }

  private renderContentAfterErrorMessage(error: Error) {
    if (!isErrorWithMetaData(error)) {
      return undefined
    }

    const { retryAction } = error.metadata

    if (retryAction && retryAction.type === RetryActionType.Clone) {
      return (
        <p>
          Would you like to retry cloning <Ref>{retryAction.name}</Ref>?
        </p>
      )
    }

    return undefined
  }

  private onDialogContentRef = (ref: HTMLDivElement | null) => {
    this.dialogContent = ref
  }

  private scrollToBottomOfGitErrorMessage() {
    if (!this.dialogContent || !this.state.error) {
      return
    }

    const e = getUnderlyingError(this.state.error)

    if (isGitError(e)) {
      if (e.message === e.result.stderr || e.message === e.result.stdout) {
        this.dialogContent.scrollTop = this.dialogContent.scrollHeight
      }
    }
  }

  public componentDidMount() {
    this.scrollToBottomOfGitErrorMessage()
  }

  public componentDidUpdate(
    prevProps: IAppErrorProps,
    prevState: IAppErrorState
  ) {
    if (prevState.error !== this.state.error) {
      this.scrollToBottomOfGitErrorMessage()
    }
  }

  private onCloseButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    this.onDismissed()
  }

  private renderFooter(error: Error) {
    if (isErrorWithMetaData(error)) {
      const metaDataFooter = this.renderErrorWithMetaDataFooter(error)

      if (metaDataFooter) {
        return metaDataFooter
      }
    }

    const e = getUnderlyingError(error)

    if (isGitError(e)) {
      return this.renderGitErrorFooter(e)
    }

    return <DefaultDialogFooter onButtonClick={this.onCloseButtonClick} />
  }

  public render() {
    return (
      <CSSTransitionGroup
        transitionName="modal"
        component="div"
        transitionEnterTimeout={dialogTransitionEnterTimeout}
        transitionLeaveTimeout={dialogTransitionLeaveTimeout}
      >
        {this.renderDialog()}
      </CSSTransitionGroup>
    )
  }
}

function getUnderlyingError(error: Error): Error {
  return isErrorWithMetaData(error) ? error.underlyingError : error
}

function isErrorWithMetaData(error: Error): error is ErrorWithMetadata {
  return error instanceof ErrorWithMetadata
}

function isGitError(error: Error): error is GitError {
  return error instanceof GitError
}
