export class Cancelable {
    _canceled: boolean
    constructor() {
        this._canceled = false;
    }

    cancel() {
        this._canceled = true;
    }

    isCanceled(): boolean {
        return this._canceled;
    }
}
