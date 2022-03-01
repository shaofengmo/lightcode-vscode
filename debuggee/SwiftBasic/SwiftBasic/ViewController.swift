//
//  ViewController.swift
//  SwiftBasic
//
//  Created by Shaofeng Mo on 1/2/22.
//

import UIKit

class ViewController: UIViewController {

    override func viewDidLoad() {
        super.viewDidLoad()
        let v = getValue()
        print(v)
    }

    func getValue() -> Int {
        return 20;
    }

}

